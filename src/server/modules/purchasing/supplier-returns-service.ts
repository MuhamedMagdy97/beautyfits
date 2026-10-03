import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db, type TransactionClient } from "@/server/db/transaction";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { requestApproval } from "@/server/modules/approvals/approvals";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { validationError } from "@/server/modules/catalog/errors";
import { lockPurchase } from "@/server/modules/purchasing/purchase-orders";
import type { PurchaseActor } from "@/server/modules/purchasing/purchase-orders-service";
import type {
  CreateSupplierReturnInput,
  ListSupplierReturnsQuery,
  SettleSupplierReturnInput,
} from "@/server/modules/purchasing/schemas";
import { postLedgerEntry } from "@/server/modules/purchasing/supplier-ledger";
import {
  approveReturn,
  assertReturnable,
  assertReturnStatus,
  lockReturn,
  returnableQuantities,
  supplierReturnNotFound,
} from "@/server/modules/purchasing/supplier-returns";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Supplier returns (TASK-024, Business Spec Q105-Q107, Q120, User Flows
 * §14.4, API §21, ADR-0029).
 *
 * DRAFT → PENDING_APPROVAL → APPROVED → SETTLED, or REJECTED (final).
 * - A return sends back damaged units of a purchase order's goods receipt
 *   lines (Q106), at the purchase line's unit cost (Q120).
 * - Submitting opens a `SUPPLIER_RETURN` approval request for an Owner/Admin
 *   (Q105); an Owner/Admin's own return is approved at once.
 * - Approval moves the units out of Damaged stock.
 * - Settlement records the refund or credit in the supplier ledger (Q107).
 */

/** Who may read supplier returns: who makes them, and supplier finance. */
export const SUPPLIER_RETURN_READERS: readonly PermissionCode[] = [
  "SUPPLIER_RETURN_MANAGE",
  "SUPPLIER_FINANCE_VIEW",
  "SUPPLIER_PAYMENT_MANAGE",
];

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

interface PersonRef {
  id: string;
  displayName: string;
}

export interface SupplierReturnView {
  id: string;
  returnNumber: string;
  status: string;
  supplier: { id: string; name: string };
  purchase: { id: string; purchaseNumber: string };
  reason: string;
  /** Σ quantity × unit cost (Q120). */
  expectedAmount: number;
  financialResolution: string | null;
  financialAmount: number | null;
  settlementNotes: string | null;
  items: {
    id: string;
    goodsReceiptItemId: string;
    receiptNumber: string;
    purchaseItemId: string;
    variantId: string;
    sku: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
    reason: string | null;
  }[];
  createdBy: PersonRef;
  createdAt: string;
  submittedAt: string | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  settledBy: PersonRef | null;
  settledAt: string | null;
  updatedAt: string;
  /** The latest approval request (shows a rejection reason). */
  approval: { id: string; status: string; resolutionReason: string | null } | null;
}

const person = { select: { id: true, displayName: true } } as const;

const viewInclude = {
  supplier: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, purchaseNumber: true } },
  createdBy: person,
  approvedBy: person,
  settledBy: person,
  items: {
    orderBy: { id: "asc" },
    include: {
      variant: { select: { sku: true } },
      goodsReceiptItem: { select: { goodsReceipt: { select: { receiptNumber: true } } } },
    },
  },
} as const satisfies Prisma.SupplierReturnInclude;

type ViewRow = Prisma.SupplierReturnGetPayload<{ include: typeof viewInclude }>;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toView(
  row: ViewRow,
  approval: { id: string; status: string; resolutionReason: string | null } | null,
): SupplierReturnView {
  return {
    id: row.id,
    returnNumber: row.returnNumber,
    status: row.status,
    supplier: row.supplier,
    purchase: row.purchaseOrder,
    reason: row.reason,
    expectedAmount: toJsonNumber(row.expectedAmount),
    financialResolution: row.financialResolution,
    financialAmount: row.financialAmount === null ? null : toJsonNumber(row.financialAmount),
    settlementNotes: row.settlementNotes,
    items: row.items.map((item) => ({
      id: item.id,
      goodsReceiptItemId: item.goodsReceiptItemId,
      receiptNumber: item.goodsReceiptItem.goodsReceipt.receiptNumber,
      purchaseItemId: item.purchaseItemId,
      variantId: item.productVariantId,
      sku: item.variant.sku,
      quantity: item.quantity,
      unitCost: toJsonNumber(item.unitCost),
      lineTotal: toJsonNumber(item.unitCost * BigInt(item.quantity)),
      reason: item.reason,
    })),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    submittedAt: iso(row.submittedAt),
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    settledBy: row.settledBy,
    settledAt: iso(row.settledAt),
    updatedAt: row.updatedAt.toISOString(),
    approval,
  };
}

async function loadReturn(db: Db, returnId: string): Promise<SupplierReturnView> {
  const row = await db.supplierReturn.findUnique({ where: { id: returnId }, include: viewInclude });
  if (!row) {
    throw supplierReturnNotFound();
  }
  const approval = await db.approvalRequest.findFirst({
    where: {
      approvalType: "SUPPLIER_RETURN",
      entityType: AUDIT_ENTITY_TYPES.supplierReturn,
      entityId: returnId,
    },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, resolutionReason: true },
  });
  return toView(row, approval);
}

export function createSupplierReturnsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  function inTx<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return runInTransaction(work, {}, db);
  }

  /** `POST /admin/purchases/{id}/supplier-return` (`SUPPLIER_RETURN_MANAGE`): a draft. */
  async function createReturn(
    actor: PurchaseActor,
    purchaseId: string,
    input: CreateSupplierReturnInput,
    ctx: Ctx,
  ): Promise<SupplierReturnView> {
    const now = clock.now();
    const created = await inTx(async (tx) => {
      await lockPurchase(tx, purchaseId);
      const order = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseId },
        select: { supplierId: true },
      });
      const ids = input.items.map((item) => item.goodsReceiptItemId.toLowerCase());
      const receiptItems = await tx.goodsReceiptItem.findMany({
        where: { id: { in: ids }, goodsReceipt: { purchaseOrderId: purchaseId } },
        include: { purchaseItem: { select: { productVariantId: true, unitCost: true } } },
      });
      const byId = new Map(receiptItems.map((item) => [item.id, item]));
      const left = await returnableQuantities(tx, ids, null);
      const lines = input.items.map((item, index) => {
        const receiptItem = byId.get(ids[index]);
        if (!receiptItem) {
          throw validationError(
            `items.${index}.goodsReceiptItemId`,
            "goods_receipt_item_not_found",
            "This goods receipt line is not on the purchase order.",
          );
        }
        if (item.quantity > left.get(receiptItem.id)!) {
          throw validationError(
            `items.${index}.quantity`,
            "quantity_exceeds_returnable",
            "Only damaged units of this line that are not already on another return can go back.",
          );
        }
        return {
          goodsReceiptItemId: receiptItem.id,
          purchaseItemId: receiptItem.purchaseItemId,
          productVariantId: receiptItem.purchaseItem.productVariantId,
          quantity: item.quantity,
          unitCost: receiptItem.purchaseItem.unitCost,
          reason: item.reason ?? null,
        };
      });
      const expectedAmount = lines.reduce(
        (sum, line) => sum + line.unitCost * BigInt(line.quantity),
        BigInt(0),
      );
      const supplierReturn = await tx.supplierReturn.create({
        data: {
          supplierId: order.supplierId,
          purchaseOrderId: purchaseId,
          reason: input.reason,
          expectedAmount,
          createdByEmployeeId: actor.employeeId,
          createdAt: now,
          updatedAt: now,
          items: { create: lines },
        },
      });
      await recordAudit(tx, {
        actor: employeeActor(actor.employeeId),
        action: "SUPPLIER_RETURN_CREATED",
        entityType: AUDIT_ENTITY_TYPES.supplierReturn,
        entityId: supplierReturn.id,
        next: {
          status: "DRAFT",
          purchaseId,
          returnNumber: supplierReturn.returnNumber,
          expectedAmount: toJsonNumber(expectedAmount),
          items: lines.map((line) => ({
            goodsReceiptItemId: line.goodsReceiptItemId,
            variantId: line.productVariantId,
            quantity: line.quantity,
            unitCost: toJsonNumber(line.unitCost),
          })),
        },
        reason: input.reason,
        correlationId: ctx.correlationId,
        createdAt: now,
      });
      return supplierReturn;
    });
    ctx.logger.info("supplier return created", {
      purchaseId,
      supplierReturnId: created.id,
      actorEmployeeId: actor.employeeId,
    });
    return loadReturn(db, created.id);
  }

  /**
   * `POST /admin/supplier-returns/{id}/submit` (`SUPPLIER_RETURN_MANAGE`):
   * Owner review (Q105). An Owner/Admin (`PURCHASE_APPROVE`) approves at once.
   */
  async function submitReturn(
    actor: PurchaseActor,
    returnId: string,
    input: { reason?: string },
    ctx: Ctx,
  ): Promise<SupplierReturnView> {
    const now = clock.now();
    const change = { employeeId: actor.employeeId, now, correlationId: ctx.correlationId };
    await inTx(async (tx) => {
      const locked = await lockReturn(tx, returnId);
      assertReturnStatus(locked.status, ["DRAFT"], "submit");
      await lockPurchase(tx, locked.purchaseOrderId);
      await assertReturnable(tx, locked);
      await tx.supplierReturn.update({
        where: { id: returnId },
        data: { status: "PENDING_APPROVAL", submittedAt: now, updatedAt: now },
      });
      await recordAudit(tx, {
        actor: employeeActor(actor.employeeId),
        action: "SUPPLIER_RETURN_SUBMITTED",
        entityType: AUDIT_ENTITY_TYPES.supplierReturn,
        entityId: returnId,
        previous: { status: "DRAFT" },
        next: { status: "PENDING_APPROVAL" },
        reason: input.reason ?? null,
        correlationId: ctx.correlationId,
        createdAt: now,
      });
      if (actor.permissions.has("PURCHASE_APPROVE")) {
        await approveReturn(tx, returnId, {
          ...change,
          reason: "Approved on submit (Owner/Admin).",
        });
      } else {
        await requestApproval(
          tx,
          {
            approvalType: "SUPPLIER_RETURN",
            entityType: AUDIT_ENTITY_TYPES.supplierReturn,
            entityId: returnId,
            requestedByEmployeeId: actor.employeeId,
            reason: input.reason ?? locked.reason,
            metadata: {
              returnNumber: locked.returnNumber,
              purchaseId: locked.purchaseOrderId,
              supplierId: locked.supplierId,
              expectedAmount: toJsonNumber(locked.expectedAmount),
            },
          },
          { now, correlationId: ctx.correlationId },
        );
      }
    });
    return loadReturn(db, returnId);
  }

  /**
   * `POST /admin/supplier-returns/{id}/settle` (`SUPPLIER_PAYMENT_MANAGE`,
   * Q107, Q120). CREDIT lowers what we owe; REFUND also records the cash
   * received, so the balance nets to zero; OTHER moves no money.
   */
  async function settleReturn(
    actor: PurchaseActor,
    returnId: string,
    input: SettleSupplierReturnInput,
    ctx: Ctx,
  ): Promise<SupplierReturnView> {
    const now = clock.now();
    await inTx(async (tx) => {
      const locked = await lockReturn(tx, returnId);
      assertReturnStatus(locked.status, ["APPROVED"], "settle");
      if (input.resolution === "OTHER" && input.amount !== undefined) {
        throw validationError("amount", "amount_not_allowed", "OTHER settlements move no money.");
      }
      const amount =
        input.resolution === "OTHER" ? BigInt(0) : (input.amount ?? locked.expectedAmount);
      if ((input.resolution === "OTHER" || amount !== locked.expectedAmount) && !input.notes) {
        throw validationError(
          "notes",
          "notes_required",
          "Explain a settlement that differs from the expected refund or credit.",
        );
      }
      const entry = {
        supplierId: locked.supplierId,
        amount,
        reference: locked.returnNumber,
        purchaseOrderId: locked.purchaseOrderId,
        supplierReturnId: returnId,
        employeeId: actor.employeeId,
        now,
      };
      const ledgerEntryIds: string[] = [];
      if (input.resolution !== "OTHER") {
        ledgerEntryIds.push(await postLedgerEntry(tx, { ...entry, entryType: "CREDIT" }));
      }
      if (input.resolution === "REFUND") {
        ledgerEntryIds.push(await postLedgerEntry(tx, { ...entry, entryType: "REFUND" }));
      }
      await tx.supplierReturn.update({
        where: { id: returnId },
        data: {
          status: "SETTLED",
          financialResolution: input.resolution,
          financialAmount: amount,
          settlementNotes: input.notes ?? null,
          settledByEmployeeId: actor.employeeId,
          settledAt: now,
          updatedAt: now,
        },
      });
      await recordAudit(tx, {
        actor: employeeActor(actor.employeeId),
        action: "SUPPLIER_RETURN_SETTLED",
        entityType: AUDIT_ENTITY_TYPES.supplierReturn,
        entityId: returnId,
        previous: { status: "APPROVED" },
        next: {
          status: "SETTLED",
          resolution: input.resolution,
          amount: toJsonNumber(amount),
          expectedAmount: toJsonNumber(locked.expectedAmount),
          ledgerEntryIds,
        },
        reason: input.notes ?? null,
        correlationId: ctx.correlationId,
        createdAt: now,
      });
    });
    ctx.logger.info("supplier return settled", {
      supplierReturnId: returnId,
      actorEmployeeId: actor.employeeId,
    });
    return loadReturn(db, returnId);
  }

  function getReturn(returnId: string): Promise<SupplierReturnView> {
    return loadReturn(db, returnId);
  }

  async function listReturns(
    query: ListSupplierReturnsQuery,
  ): Promise<{ items: SupplierReturnView[]; pagination: Pagination }> {
    const where: Prisma.SupplierReturnWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.purchaseId ? { purchaseOrderId: query.purchaseId } : {}),
    };
    const [total, rows] = await Promise.all([
      db.supplierReturn.count({ where }),
      db.supplierReturn.findMany({
        where,
        include: viewInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const approvals = await db.approvalRequest.findMany({
      where: {
        approvalType: "SUPPLIER_RETURN",
        entityType: AUDIT_ENTITY_TYPES.supplierReturn,
        entityId: { in: rows.map((row) => row.id) },
      },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      select: { id: true, status: true, resolutionReason: true, entityId: true },
    });
    // The latest request per return wins.
    const byReturn = new Map(
      approvals.map(({ entityId, ...approval }) => [entityId, approval] as const),
    );
    return {
      items: rows.map((row) => toView(row, byReturn.get(row.id) ?? null)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  return { createReturn, submitReturn, settleReturn, getReturn, listReturns };
}

export type SupplierReturnsService = ReturnType<typeof createSupplierReturnsService>;

let defaultService: SupplierReturnsService | undefined;

export function getSupplierReturnsService(): SupplierReturnsService {
  defaultService ??= createSupplierReturnsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
