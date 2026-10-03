import type { Db, TransactionClient } from "@/server/db/transaction";
import type { ApprovalHandler } from "@/server/modules/approvals/approvals";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  type AuditAction,
} from "@/server/modules/audit/audit";
import { nextWeightedAverageCost } from "@/server/modules/catalog/pricing";
import { lockPurchase } from "@/server/modules/purchasing/purchase-orders";
import { toJsonNumber } from "@/server/money/money";

/**
 * Goods receiving rules shared by the service and the
 * `PURCHASE_OVER_DELIVERY` approval handler (TASK-023, Business Spec Q101-Q104,
 * Q114-Q116, User Flows §14, ADR-0028).
 *
 * This file must not import approvals.ts at runtime: approvals.ts loads the
 * handlers, which load this file.
 */

export const GOODS_RECEIPT_REFERENCE_TYPE = "GOODS_RECEIPT";

export interface DeliverySplit {
  /** Into Available. */
  accepted: number;
  /** Into Damaged; counts against the ordered quantity. */
  damaged: number;
  /** Beyond the ordered quantity: waits for approval (Q116). */
  overDelivery: number;
}

/**
 * Splits one delivered line (Q115, Q116). Units up to what is still due are
 * received: the damaged ones into Damaged, the rest into Available. Good
 * units beyond that are extras. Damaged units beyond what is due are not
 * accepted at all (`DAMAGED_EXCEEDS_DUE`): they are not ours to stock.
 */
export function splitDelivery(input: {
  ordered: number;
  alreadyReceived: number;
  delivered: number;
  damaged: number;
}): DeliverySplit | { problem: "DAMAGED_EXCEEDS_DELIVERED" | "DAMAGED_EXCEEDS_DUE" } {
  const due = Math.max(input.ordered - input.alreadyReceived, 0);
  if (input.damaged > input.delivered) {
    return { problem: "DAMAGED_EXCEEDS_DELIVERED" };
  }
  if (input.damaged > due) {
    return { problem: "DAMAGED_EXCEEDS_DUE" };
  }
  const accepted = Math.min(input.delivered - input.damaged, due - input.damaged);
  return {
    accepted,
    damaged: input.damaged,
    overDelivery: input.delivered - input.damaged - accepted,
  };
}

/** A line needs a note when the delivery differs from what was due (User Flows §14.1). */
export function needsNote(split: DeliverySplit, due: number): boolean {
  return split.damaged > 0 || split.overDelivery > 0 || split.accepted + split.damaged < due;
}

export interface StockInLine {
  variantId: string;
  accepted: number;
  damaged: number;
  unitCost: bigint;
}

export interface CostChange {
  variantId: string;
  previousLatestPurchaseCost: bigint | null;
  latestPurchaseCost: bigint;
  previousWeightedAverageCost: bigint | null;
  weightedAverageCost: bigint;
  sellingPrice: bigint | null;
}

/**
 * Brings received units into stock: one `PURCHASE_RECEIPT` movement per line
 * with its unit cost, and for accepted units the variant's costs (Q103):
 * latest purchase cost = this unit cost, weighted average over the stock on
 * hand (Available + Reserved). Damaged units do not change costs. Variants
 * and balances are locked in variant id order.
 */
export async function stockIn(
  tx: Db,
  lines: readonly StockInLine[],
  context: { goodsReceiptId: string; employeeId: string; now: Date; reason?: string | null },
): Promise<CostChange[]> {
  const sorted = [...lines]
    .map((line) => ({ ...line, variantId: line.variantId.toLowerCase() }))
    .sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
  const ids = sorted.map((line) => line.variantId);
  const variants = await tx.$queryRaw<
    {
      id: string;
      latest: bigint | null;
      average: bigint | null;
      price: bigint | null;
      available: number;
      reserved: number;
    }[]
  >`
    SELECT v.id, v.latest_purchase_cost AS latest, v.weighted_average_cost AS average,
           v.selling_price AS price, b.available_quantity AS available,
           b.reserved_quantity AS reserved
    FROM product_variants v
    JOIN inventory_balances b ON b.product_variant_id = v.id
    WHERE v.id = ANY(${ids}::uuid[])
    ORDER BY v.id
    FOR UPDATE OF v, b`;
  const byId = new Map(variants.map((row) => [row.id, row]));
  const changes: CostChange[] = [];
  for (const line of sorted) {
    const current = byId.get(line.variantId)!;
    if (line.accepted > 0) {
      const average = nextWeightedAverageCost(
        current.available + current.reserved,
        current.average,
        line.accepted,
        line.unitCost,
      );
      await tx.productVariant.update({
        where: { id: line.variantId },
        data: {
          latestPurchaseCost: line.unitCost,
          weightedAverageCost: average,
          updatedAt: context.now,
        },
      });
      await tx.productVariant.updateMany({
        where: { id: line.variantId, firstGoodsReceiptAt: null },
        data: { firstGoodsReceiptAt: context.now },
      });
      changes.push({
        variantId: line.variantId,
        previousLatestPurchaseCost: current.latest,
        latestPurchaseCost: line.unitCost,
        previousWeightedAverageCost: current.average,
        weightedAverageCost: average,
        sellingPrice: current.price,
      });
    }
    if (line.accepted + line.damaged > 0) {
      await tx.inventoryMovement.create({
        data: {
          productVariantId: line.variantId,
          movementType: "PURCHASE_RECEIPT",
          availableDelta: line.accepted,
          damagedDelta: line.damaged,
          referenceType: GOODS_RECEIPT_REFERENCE_TYPE,
          referenceId: context.goodsReceiptId,
          unitCost: line.unitCost,
          reason: context.reason ?? null,
          createdByType: "EMPLOYEE",
          createdById: context.employeeId,
          createdAt: context.now,
        },
      });
    }
  }
  return changes;
}

/** Cost changes as audit JSON. */
export function costSnapshot(changes: readonly CostChange[]) {
  const amount = (value: bigint | null) => (value === null ? null : toJsonNumber(value));
  return changes.map((change) => ({
    variantId: change.variantId,
    latestPurchaseCost: [
      amount(change.previousLatestPurchaseCost),
      amount(change.latestPurchaseCost),
    ],
    weightedAverageCost: [
      amount(change.previousWeightedAverageCost),
      amount(change.weightedAverageCost),
    ],
  }));
}

/** The extras of a receipt, with what is needed to stock them. */
async function extrasOf(tx: Db, goodsReceiptId: string) {
  const items = await tx.goodsReceiptItem.findMany({
    where: { goodsReceiptId, overDeliveryQuantity: { gt: 0 } },
    include: { purchaseItem: true, goodsReceipt: { select: { purchaseOrderId: true } } },
  });
  return items.map((item) => ({
    purchaseOrderId: item.goodsReceipt.purchaseOrderId,
    purchaseItemId: item.purchaseItemId,
    variantId: item.purchaseItem.productVariantId,
    quantity: item.overDeliveryQuantity,
    unitCost: item.purchaseItem.unitCost,
  }));
}

async function resolveExtras(
  tx: TransactionClient,
  goodsReceiptId: string,
  outcome: "ACCEPTED" | "REJECTED",
  context: { employeeId: string; now: Date; correlationId: string | null; reason: string | null },
): Promise<void> {
  const extras = await extrasOf(tx, goodsReceiptId);
  if (extras.length === 0) {
    return;
  }
  const purchaseId = extras[0].purchaseOrderId;
  // Serializes with receipts of the same order.
  await lockPurchase(tx, purchaseId);
  let costs: CostChange[] = [];
  if (outcome === "ACCEPTED") {
    // At the line's unit cost (owner decision, ADR-0028 §3).
    costs = await stockIn(
      tx,
      extras.map((extra) => ({
        variantId: extra.variantId,
        accepted: extra.quantity,
        damaged: 0,
        unitCost: extra.unitCost,
      })),
      { goodsReceiptId, employeeId: context.employeeId, now: context.now, reason: context.reason },
    );
  }
  const action: AuditAction =
    outcome === "ACCEPTED" ? "PURCHASE_OVER_DELIVERY_ACCEPTED" : "PURCHASE_OVER_DELIVERY_REJECTED";
  await recordAudit(tx, {
    actor: employeeActor(context.employeeId),
    action,
    entityType: AUDIT_ENTITY_TYPES.purchaseOrder,
    entityId: purchaseId,
    next: {
      goodsReceiptId,
      items: extras.map((extra) => ({
        purchaseItemId: extra.purchaseItemId,
        variantId: extra.variantId,
        quantity: extra.quantity,
      })),
      ...(costs.length > 0 ? { costs: costSnapshot(costs) } : {}),
    },
    reason: context.reason,
    correlationId: context.correlationId,
    createdAt: context.now,
  });
}

/** Accepts the extras into Available, or records that they went back (Q116). */
export function acceptExtras(
  tx: TransactionClient,
  goodsReceiptId: string,
  context: { employeeId: string; now: Date; correlationId: string | null; reason: string | null },
): Promise<void> {
  return resolveExtras(tx, goodsReceiptId, "ACCEPTED", context);
}

/** `PURCHASE_OVER_DELIVERY` requests: entity `GOODS_RECEIPT`, one per receipt with extras. */
export const overDeliveryApprovalHandler: ApprovalHandler = {
  async onApproved(tx, request, context) {
    await acceptExtras(tx, request.entityId, {
      employeeId: context.resolverEmployeeId,
      now: context.now,
      correlationId: context.correlationId,
      reason: context.reason,
    });
  },
  async onRejected(tx, request, context) {
    await resolveExtras(tx, request.entityId, "REJECTED", {
      employeeId: context.resolverEmployeeId,
      now: context.now,
      correlationId: context.correlationId,
      reason: context.reason,
    });
  },
};
