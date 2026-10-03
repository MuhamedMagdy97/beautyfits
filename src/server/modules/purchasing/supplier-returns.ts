import type { SupplierReturnStatus } from "@/generated/prisma/client";
import type { Db, TransactionClient } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { ApprovalHandler } from "@/server/modules/approvals/approvals";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict } from "@/server/modules/catalog/errors";
import { lockPurchase } from "@/server/modules/purchasing/purchase-orders";

/**
 * Supplier return rules shared by the service and the `SUPPLIER_RETURN`
 * approval handler (TASK-024, Business Spec Q105-Q107, Q120, User Flows §14.4,
 * ADR-0029).
 *
 * This file must not import approvals.ts at runtime: approvals.ts loads the
 * handlers, which load this file.
 */

export const SUPPLIER_RETURN_REFERENCE_TYPE = "SUPPLIER_RETURN";

/** Returns that hold damaged units: everything but drafts and rejected ones. */
export const ACTIVE_RETURN_STATUSES: readonly SupplierReturnStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "SETTLED",
];

export interface ReturnChange {
  employeeId: string;
  now: Date;
  correlationId: string | null;
  reason?: string | null;
}

export function supplierReturnNotFound(): AppError {
  return new AppError("NOT_FOUND", "Supplier return not found.");
}

/** Locks the return row and returns it. */
export async function lockReturn(tx: Db, returnId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM supplier_returns WHERE id = ${returnId}::uuid FOR UPDATE`;
  if (rows.length === 0) {
    throw supplierReturnNotFound();
  }
  return tx.supplierReturn.findUniqueOrThrow({ where: { id: returnId }, include: { items: true } });
}

export function assertReturnStatus(
  current: SupplierReturnStatus,
  allowed: readonly SupplierReturnStatus[],
  action: string,
): void {
  if (!allowed.includes(current)) {
    throw conflict(`Cannot ${action} a supplier return whose status is ${current}.`, {
      reason: "SUPPLIER_RETURN_STATUS_INVALID",
      status: current,
    });
  }
}

/**
 * The damaged units of goods receipt lines that can still go back: damaged on
 * receipt minus what active returns (other than `excludeReturnId`) hold.
 */
export async function returnableQuantities(
  tx: Db,
  goodsReceiptItemIds: readonly string[],
  excludeReturnId: string | null,
): Promise<Map<string, number>> {
  const [items, held] = await Promise.all([
    tx.goodsReceiptItem.findMany({
      where: { id: { in: [...goodsReceiptItemIds] } },
      select: { id: true, damagedQuantity: true },
    }),
    tx.supplierReturnItem.groupBy({
      by: ["goodsReceiptItemId"],
      where: {
        goodsReceiptItemId: { in: [...goodsReceiptItemIds] },
        supplierReturn: {
          status: { in: [...ACTIVE_RETURN_STATUSES] },
          ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
        },
      },
      _sum: { quantity: true },
    }),
  ]);
  const heldBy = new Map(held.map((row) => [row.goodsReceiptItemId, row._sum.quantity ?? 0]));
  return new Map(items.map((item) => [item.id, item.damagedQuantity - (heldBy.get(item.id) ?? 0)]));
}

/** Every line of the return still fits in what can go back (`409 RETURN_QUANTITY_EXCEEDED`). */
export async function assertReturnable(
  tx: Db,
  supplierReturn: { id: string; items: { goodsReceiptItemId: string; quantity: number }[] },
): Promise<void> {
  const left = await returnableQuantities(
    tx,
    supplierReturn.items.map((item) => item.goodsReceiptItemId),
    supplierReturn.id,
  );
  for (const item of supplierReturn.items) {
    if (item.quantity > (left.get(item.goodsReceiptItemId) ?? 0)) {
      throw conflict("These damaged units are already on another supplier return.", {
        reason: "RETURN_QUANTITY_EXCEEDED",
        goodsReceiptItemId: item.goodsReceiptItemId,
      });
    }
  }
}

/**
 * PENDING_APPROVAL → APPROVED: the units leave Damaged stock with one
 * `SUPPLIER_RETURN` movement per line (owner decision, ADR-0029 §3).
 */
export async function approveReturn(
  tx: TransactionClient,
  returnId: string,
  change: ReturnChange,
): Promise<void> {
  const locked = await lockReturn(tx, returnId);
  assertReturnStatus(locked.status, ["PENDING_APPROVAL"], "approve");
  // Serializes with other returns and receipts of the order.
  await lockPurchase(tx, locked.purchaseOrderId);
  await assertReturnable(tx, locked);

  const needed = new Map<string, number>();
  for (const item of locked.items) {
    needed.set(item.productVariantId, (needed.get(item.productVariantId) ?? 0) + item.quantity);
  }
  const ids = [...needed.keys()].sort();
  const balances = await tx.$queryRaw<{ id: string; damaged: number }[]>`
    SELECT product_variant_id AS id, damaged_quantity AS damaged FROM inventory_balances
    WHERE product_variant_id = ANY(${ids}::uuid[])
    ORDER BY product_variant_id
    FOR UPDATE`;
  for (const balance of balances) {
    if (balance.damaged < needed.get(balance.id)!) {
      // E.g. written off since it was received.
      throw conflict("Damaged stock is lower than the units to return.", {
        reason: "DAMAGED_STOCK_INSUFFICIENT",
        variantId: balance.id,
        damagedQuantity: balance.damaged,
      });
    }
  }
  for (const item of locked.items) {
    await tx.inventoryMovement.create({
      data: {
        productVariantId: item.productVariantId,
        movementType: "SUPPLIER_RETURN",
        damagedDelta: -item.quantity,
        referenceType: SUPPLIER_RETURN_REFERENCE_TYPE,
        referenceId: returnId,
        unitCost: item.unitCost,
        reason: change.reason ?? null,
        createdByType: "EMPLOYEE",
        createdById: change.employeeId,
        createdAt: change.now,
      },
    });
  }
  await tx.supplierReturn.update({
    where: { id: returnId },
    data: {
      status: "APPROVED",
      approvedByEmployeeId: change.employeeId,
      approvedAt: change.now,
      updatedAt: change.now,
    },
  });
  await recordAudit(tx, {
    actor: employeeActor(change.employeeId),
    action: "SUPPLIER_RETURN_APPROVED",
    entityType: AUDIT_ENTITY_TYPES.supplierReturn,
    entityId: returnId,
    previous: { status: "PENDING_APPROVAL" },
    next: {
      status: "APPROVED",
      items: locked.items.map((item) => ({
        variantId: item.productVariantId,
        goodsReceiptItemId: item.goodsReceiptItemId,
        quantity: item.quantity,
      })),
    },
    reason: change.reason ?? null,
    correlationId: change.correlationId,
    createdAt: change.now,
  });
}

/** Approval moves the stock out; rejection is final (ADR-0029 §3). */
export const supplierReturnApprovalHandler: ApprovalHandler = {
  async onApproved(tx, request, context) {
    await approveReturn(tx, request.entityId, {
      employeeId: context.resolverEmployeeId,
      now: context.now,
      correlationId: context.correlationId,
      reason: context.reason,
    });
  },
  async onRejected(tx, request, context) {
    const locked = await lockReturn(tx, request.entityId);
    assertReturnStatus(locked.status, ["PENDING_APPROVAL"], "reject");
    await tx.supplierReturn.update({
      where: { id: locked.id },
      data: { status: "REJECTED", updatedAt: context.now },
    });
    await recordAudit(tx, {
      actor: employeeActor(context.resolverEmployeeId),
      action: "SUPPLIER_RETURN_REJECTED",
      entityType: AUDIT_ENTITY_TYPES.supplierReturn,
      entityId: locked.id,
      previous: { status: "PENDING_APPROVAL" },
      next: { status: "REJECTED" },
      reason: context.reason,
      correlationId: context.correlationId,
      createdAt: context.now,
    });
  },
};
