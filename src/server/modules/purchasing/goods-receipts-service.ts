import { createHash } from "node:crypto";
import type { PrismaClient, PurchaseOrderStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type TransactionClient } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Logger } from "@/server/logging/logger";
import { requestApproval } from "@/server/modules/approvals/approvals";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import {
  marginBasisPoints,
  marginWarnings,
  type MarginWarning,
} from "@/server/modules/catalog/pricing";
import { lockAttachableAsset } from "@/server/modules/media/uploads-service";
import {
  acceptExtras,
  costSnapshot,
  needsNote,
  splitDelivery,
  stockIn,
  type CostChange,
  type DeliverySplit,
} from "@/server/modules/purchasing/goods-receipts";
import {
  assertStatus,
  changeStatus,
  lockPurchase,
} from "@/server/modules/purchasing/purchase-orders";
import {
  loadView,
  purchaseAccess,
  type GoodsReceiptView,
  type PurchaseActor,
  type PurchaseView,
} from "@/server/modules/purchasing/purchase-orders-service";
import type { ReceivePurchaseInput, RecordInvoiceInput } from "@/server/modules/purchasing/schemas";
import { readMinMarginBasisPoints } from "@/server/modules/settings/settings";
import { toJsonNumber } from "@/server/money/money";
import { MS_PER_DAY, systemClock, type Clock } from "@/server/time/time";

/**
 * Goods receiving, supplier invoices and closing (TASK-023, Business Spec
 * Q101-Q104, Q114-Q117, User Flows §14, API §21, ADR-0028).
 *
 * - One step: the receiver records what arrived, line by line, after
 *   inspecting it; stock changes in the same transaction (owner decision).
 * - Units up to what is still due are received: good ones into Available,
 *   damaged ones into Damaged. Good units beyond that are extras and wait for
 *   a `PURCHASE_OVER_DELIVERY` approval (Q116); an Owner/Admin's own receipt
 *   accepts them at once, like their purchase orders (ADR-0027 §3).
 * - Invoices are recorded as issued and never edited (Q115, Q117).
 * - An order nothing more will arrive for is closed by hand, once invoiced.
 */

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

export interface CostReviewItem {
  variantId: string;
  previousLatestPurchaseCost: number | null;
  latestPurchaseCost: number;
  weightedAverageCost: number;
  sellingPrice: number | null;
  marginBasisPoints: number | null;
  /** The new cost is higher than the previous one (Q102). */
  marginReduced: boolean;
  warnings: MarginWarning[];
}

export interface ReceiveResult {
  receipt: GoodsReceiptView;
  purchase: PurchaseView;
  /** Q102 selling-price review; only for callers with `VIEW_COST_PRICE`. */
  costReview?: CostReviewItem[];
}

const RECEIVE_OPERATION = "GOODS_RECEIPT";
/** How long a receive can be retried with the same key. */
const IDEMPOTENCY_TTL_MS = 7 * MS_PER_DAY;
const RECEIVABLE: readonly PurchaseOrderStatus[] = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];

function fingerprint(purchaseId: string, input: ReceivePurchaseInput): string {
  return createHash("sha256").update(JSON.stringify({ purchaseId, input })).digest("hex");
}

async function costReview(
  tx: TransactionClient,
  changes: readonly CostChange[],
  logger: Logger,
): Promise<CostReviewItem[]> {
  const minimum = await readMinMarginBasisPoints(tx, logger);
  return changes.map((change) => {
    const price = change.sellingPrice;
    return {
      variantId: change.variantId,
      previousLatestPurchaseCost:
        change.previousLatestPurchaseCost === null
          ? null
          : toJsonNumber(change.previousLatestPurchaseCost),
      latestPurchaseCost: toJsonNumber(change.latestPurchaseCost),
      weightedAverageCost: toJsonNumber(change.weightedAverageCost),
      sellingPrice: price === null ? null : toJsonNumber(price),
      marginBasisPoints:
        price === null ? null : marginBasisPoints(price, change.latestPurchaseCost),
      marginReduced:
        change.previousLatestPurchaseCost !== null &&
        change.latestPurchaseCost > change.previousLatestPurchaseCost,
      warnings: price === null ? [] : marginWarnings(price, change.latestPurchaseCost, minimum),
    };
  });
}

export function createGoodsReceiptsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  function inTx<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return runInTransaction(work, {}, db);
  }

  /**
   * `POST /admin/purchases/{id}/receive`. Retrying with the same
   * Idempotency-Key and body returns the receipt already recorded.
   */
  async function receivePurchase(
    actor: PurchaseActor,
    purchaseId: string,
    input: ReceivePurchaseInput,
    idempotencyKey: string,
    ctx: Ctx,
  ): Promise<ReceiveResult> {
    const now = clock.now();
    const scope = `EMPLOYEE:${actor.employeeId}`;
    const print = fingerprint(purchaseId, input);
    const access = purchaseAccess(actor.permissions);

    const result = await inTx(async (tx) => {
      // The order lock also serializes retries of the same key.
      const order = await lockPurchase(tx, purchaseId);
      const previous = await tx.idempotencyKey.findUnique({
        where: {
          scope_operation_key: { scope, operation: RECEIVE_OPERATION, key: idempotencyKey },
        },
      });
      if (previous) {
        if (previous.requestFingerprint !== print) {
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This Idempotency-Key was used for a different request.",
          );
        }
        return { receiptId: previous.resourceId!, review: undefined, replayed: true };
      }
      assertStatus(order.status, RECEIVABLE, "receive");

      const lines = await tx.purchaseItem.findMany({
        where: { purchaseOrderId: purchaseId },
        include: {
          receiptItems: { select: { acceptedQuantity: true, damagedQuantity: true } },
        },
      });
      const byId = new Map(lines.map((line) => [line.id, line]));
      const received = new Map(
        lines.map((line) => [
          line.id,
          line.receiptItems.reduce(
            (sum, item) => sum + item.acceptedQuantity + item.damagedQuantity,
            0,
          ),
        ]),
      );

      const splits = input.items.map((item, index) => {
        const line = byId.get(item.purchaseItemId.toLowerCase());
        if (!line) {
          throw validationError(
            `items.${index}.purchaseItemId`,
            "purchase_item_not_found",
            "This line is not on the purchase order.",
          );
        }
        const alreadyReceived = received.get(line.id)!;
        const split = splitDelivery({
          ordered: line.orderedQuantity,
          alreadyReceived,
          delivered: item.deliveredQuantity,
          damaged: item.damagedQuantity,
        });
        if ("problem" in split) {
          throw validationError(
            `items.${index}.damagedQuantity`,
            split.problem.toLowerCase(),
            split.problem === "DAMAGED_EXCEEDS_DELIVERED"
              ? "Damaged units cannot be more than the delivered units."
              : "Damaged units cannot be more than the units still due; record damaged extras in the notes and do not count them as delivered.",
          );
        }
        const due = Math.max(line.orderedQuantity - alreadyReceived, 0);
        if (needsNote(split, due) && !item.notes) {
          throw validationError(
            `items.${index}.notes`,
            "notes_required",
            "Describe how this line differs from what was due (short, damaged or extra units).",
          );
        }
        received.set(line.id, alreadyReceived + split.accepted + split.damaged);
        return { item, line, split };
      });

      const receipt = await tx.goodsReceipt.create({
        data: {
          purchaseOrderId: purchaseId,
          receivedByEmployeeId: actor.employeeId,
          receivedAt: now,
          notes: input.notes ?? null,
          items: {
            create: splits.map(({ item, line, split }) => ({
              purchaseItemId: line.id,
              deliveredQuantity: item.deliveredQuantity,
              acceptedQuantity: split.accepted,
              damagedQuantity: split.damaged,
              overDeliveryQuantity: split.overDelivery,
              inspectionNotes: item.notes ?? null,
            })),
          },
        },
      });

      const costs = await stockIn(
        tx,
        splits.map(({ line, split }) => ({
          variantId: line.productVariantId,
          accepted: split.accepted,
          damaged: split.damaged,
          unitCost: line.unitCost,
        })),
        { goodsReceiptId: receipt.id, employeeId: actor.employeeId, now },
      );

      const extras = splits.filter(({ split }) => split.overDelivery > 0);
      if (extras.length > 0) {
        if (actor.permissions.has("PURCHASE_APPROVE")) {
          await acceptExtras(tx, receipt.id, {
            employeeId: actor.employeeId,
            now,
            correlationId: ctx.correlationId,
            reason: "Accepted on receipt (Owner/Admin).",
          });
        } else {
          await requestApproval(
            tx,
            {
              approvalType: "PURCHASE_OVER_DELIVERY",
              entityType: AUDIT_ENTITY_TYPES.goodsReceipt,
              entityId: receipt.id,
              requestedByEmployeeId: actor.employeeId,
              reason: input.notes ?? null,
              metadata: {
                purchaseId,
                receiptNumber: receipt.receiptNumber,
                items: extras.map(({ line, split }) => ({
                  purchaseItemId: line.id,
                  variantId: line.productVariantId,
                  quantity: split.overDelivery,
                })),
              },
            },
            { now, correlationId: ctx.correlationId },
          );
        }
      }

      const status: PurchaseOrderStatus = lines.every(
        (line) => received.get(line.id)! >= line.orderedQuantity,
      )
        ? "RECEIVED"
        : "PARTIALLY_RECEIVED";
      await tx.purchaseOrder.update({
        where: { id: purchaseId },
        data: { status, updatedAt: now },
      });
      await recordAudit(tx, {
        actor: employeeActor(actor.employeeId),
        action: "GOODS_RECEIPT_RECORDED",
        entityType: AUDIT_ENTITY_TYPES.purchaseOrder,
        entityId: purchaseId,
        previous: { status: order.status },
        next: {
          status,
          goodsReceiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          items: splits.map(({ line, item, split }) => ({
            purchaseItemId: line.id,
            delivered: item.deliveredQuantity,
            ...(split satisfies DeliverySplit),
          })),
          costs: costSnapshot(costs),
        },
        reason: input.notes ?? null,
        correlationId: ctx.correlationId,
        createdAt: now,
      });
      await tx.idempotencyKey.create({
        data: {
          scope,
          operation: RECEIVE_OPERATION,
          key: idempotencyKey,
          requestFingerprint: print,
          status: "COMPLETED",
          responseStatus: 201,
          resourceType: AUDIT_ENTITY_TYPES.goodsReceipt,
          resourceId: receipt.id,
          createdAt: now,
          // ponytail: expired keys are not purged yet; a cleanup job comes
          // with the checkout idempotency work.
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        },
      });
      const review = actor.permissions.has("VIEW_COST_PRICE")
        ? await costReview(tx, costs, ctx.logger)
        : undefined;
      return { receiptId: receipt.id, review, replayed: false };
    }).catch((error: unknown) => {
      // The same key used at the same time on another order.
      if (isUniqueViolation(error, "key")) {
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This Idempotency-Key was used for a different request.",
        );
      }
      throw error;
    });

    const purchase = await loadView(db, purchaseId, access);
    if (!result.replayed) {
      ctx.logger.info("goods received", {
        purchaseId,
        goodsReceiptId: result.receiptId,
        actorEmployeeId: actor.employeeId,
      });
    }
    return {
      receipt: purchase.receipts.find((receipt) => receipt.id === result.receiptId)!,
      purchase,
      ...(result.review ? { costReview: result.review } : {}),
    };
  }

  /** `POST /admin/purchases/{id}/invoice` (`SUPPLIER_PAYMENT_MANAGE`, Q117). */
  async function recordInvoice(
    actor: PurchaseActor,
    purchaseId: string,
    input: RecordInvoiceInput,
    ctx: Ctx,
  ): Promise<PurchaseView> {
    const now = clock.now();
    try {
      await inTx(async (tx) => {
        const order = await lockPurchase(tx, purchaseId);
        assertStatus(
          order.status,
          ["APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED"],
          "record an invoice for",
        );
        await lockAttachableAsset(tx, input.mediaAssetId, "SUPPLIER_INVOICE");
        const invoice = await tx.purchaseInvoice.create({
          data: {
            purchaseOrderId: purchaseId,
            invoiceNumber: input.invoiceNumber,
            invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
            invoiceTotal: input.invoiceTotal,
            taxAmount: input.taxAmount ?? null,
            mediaAssetId: input.mediaAssetId,
            notes: input.notes ?? null,
            recordedByEmployeeId: actor.employeeId,
            createdAt: now,
          },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PURCHASE_INVOICE_RECORDED",
          entityType: AUDIT_ENTITY_TYPES.purchaseOrder,
          entityId: purchaseId,
          next: {
            invoiceId: invoice.id,
            invoiceNumber: input.invoiceNumber,
            invoiceDate: input.invoiceDate,
            invoiceTotal: toJsonNumber(input.invoiceTotal),
            taxAmount: input.taxAmount == null ? null : toJsonNumber(input.taxAmount),
            mediaAssetId: input.mediaAssetId,
          },
          reason: input.notes ?? null,
          correlationId: ctx.correlationId,
          createdAt: now,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, "invoice_number")) {
        throw conflict("This invoice number is already recorded on the purchase order.", {
          reason: "INVOICE_NUMBER_TAKEN",
        });
      }
      if (isUniqueViolation(error, "media_asset_id")) {
        throw conflict("This file is already attached to an invoice.", {
          reason: "MEDIA_ALREADY_ATTACHED",
        });
      }
      throw error;
    }
    ctx.logger.info("purchase invoice recorded", { purchaseId, actorEmployeeId: actor.employeeId });
    return loadView(db, purchaseId, purchaseAccess(actor.permissions));
  }

  /**
   * `POST /admin/purchases/{id}/close` (`PURCHASE_CREATE`): nothing more will
   * be received. Needs an invoice (Q117) and no extras awaiting approval.
   */
  async function closePurchase(
    actor: PurchaseActor,
    purchaseId: string,
    input: { reason: string },
    ctx: Ctx,
  ): Promise<PurchaseView> {
    const now = clock.now();
    await inTx(async (tx) => {
      const order = await lockPurchase(tx, purchaseId);
      assertStatus(order.status, ["PARTIALLY_RECEIVED", "RECEIVED"], "close");
      if ((await tx.purchaseInvoice.count({ where: { purchaseOrderId: purchaseId } })) === 0) {
        throw conflict("Record the supplier invoice before closing the purchase order.", {
          reason: "INVOICE_REQUIRED",
        });
      }
      const receipts = await tx.goodsReceipt.findMany({
        where: { purchaseOrderId: purchaseId },
        select: { id: true },
      });
      const pending = await tx.approvalRequest.count({
        where: {
          approvalType: "PURCHASE_OVER_DELIVERY",
          entityType: AUDIT_ENTITY_TYPES.goodsReceipt,
          entityId: { in: receipts.map((receipt) => receipt.id) },
          status: "PENDING",
        },
      });
      if (pending > 0) {
        throw conflict("Over-delivered units of this order are still awaiting approval.", {
          reason: "OVER_DELIVERY_PENDING",
        });
      }
      await changeStatus(
        tx,
        purchaseId,
        order.status,
        "CLOSED",
        "PURCHASE_ORDER_CLOSED",
        {
          employeeId: actor.employeeId,
          now,
          correlationId: ctx.correlationId,
          reason: input.reason,
        },
        { closedByEmployeeId: actor.employeeId, closedAt: now, closingReason: input.reason },
      );
    });
    return loadView(db, purchaseId, purchaseAccess(actor.permissions));
  }

  return { receivePurchase, recordInvoice, closePurchase };
}

export type GoodsReceiptsService = ReturnType<typeof createGoodsReceiptsService>;

let defaultService: GoodsReceiptsService | undefined;

export function getGoodsReceiptsService(): GoodsReceiptsService {
  defaultService ??= createGoodsReceiptsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
