import type { PurchaseOrderStatus } from "@/generated/prisma/client";
import type { Db, TransactionClient } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { ApprovalHandler } from "@/server/modules/approvals/approvals";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  type AuditAction,
} from "@/server/modules/audit/audit";
import { conflict } from "@/server/modules/catalog/errors";

/**
 * Purchase order status changes shared by the service and the
 * `PURCHASE_ORDER` approval handler (TASK-022, Q113, ADR-0027).
 *
 * This file must not import approvals.ts at runtime: approvals.ts loads the
 * handlers, which load this file.
 */

export interface StatusChange {
  employeeId: string;
  now: Date;
  correlationId: string | null;
  reason?: string | null;
}

export function purchaseNotFound(): AppError {
  return new AppError("NOT_FOUND", "Purchase order not found.");
}

/** Locks the purchase order row and returns its status. */
export async function lockPurchase(
  tx: Db,
  purchaseId: string,
): Promise<{ id: string; status: PurchaseOrderStatus; createdByEmployeeId: string }> {
  const rows = await tx.$queryRaw<
    { id: string; status: PurchaseOrderStatus; created_by_employee_id: string }[]
  >`SELECT id, status, created_by_employee_id FROM purchase_orders
    WHERE id = ${purchaseId}::uuid FOR UPDATE`;
  if (rows.length === 0) {
    throw purchaseNotFound();
  }
  return {
    id: rows[0].id,
    status: rows[0].status,
    createdByEmployeeId: rows[0].created_by_employee_id,
  };
}

export function assertStatus(
  current: PurchaseOrderStatus,
  allowed: readonly PurchaseOrderStatus[],
  action: string,
): void {
  if (!allowed.includes(current)) {
    throw conflict(`Cannot ${action} a purchase order whose status is ${current}.`, {
      reason: "PURCHASE_STATUS_INVALID",
      status: current,
    });
  }
}

/** Moves the (locked) order to `to` and writes its audit entry. */
export async function changeStatus(
  tx: Db,
  purchaseId: string,
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
  action: AuditAction,
  change: StatusChange,
  data: Record<string, unknown> = {},
): Promise<void> {
  await tx.purchaseOrder.update({
    where: { id: purchaseId },
    data: { ...data, status: to, updatedAt: change.now },
  });
  await recordAudit(tx, {
    actor: employeeActor(change.employeeId),
    action,
    entityType: AUDIT_ENTITY_TYPES.purchaseOrder,
    entityId: purchaseId,
    previous: { status: from },
    next: { status: to },
    reason: change.reason ?? null,
    correlationId: change.correlationId,
    createdAt: change.now,
  });
}

export function approvePurchase(
  tx: Db,
  purchaseId: string,
  from: PurchaseOrderStatus,
  change: StatusChange,
): Promise<void> {
  return changeStatus(tx, purchaseId, from, "APPROVED", "PURCHASE_ORDER_APPROVED", change, {
    approvedByEmployeeId: change.employeeId,
    approvedAt: change.now,
  });
}

async function lockPending(tx: TransactionClient, purchaseId: string, action: string) {
  const order = await lockPurchase(tx, purchaseId);
  assertStatus(order.status, ["PENDING_APPROVAL"], action);
  return order;
}

/**
 * Approval: PENDING_APPROVAL → APPROVED. Rejection: back to DRAFT, so the
 * creator can fix and resubmit (owner decision, ADR-0027 §3).
 */
export const purchaseOrderApprovalHandler: ApprovalHandler = {
  async onApproved(tx, request, context) {
    await lockPending(tx, request.entityId, "approve");
    await approvePurchase(tx, request.entityId, "PENDING_APPROVAL", {
      employeeId: context.resolverEmployeeId,
      now: context.now,
      correlationId: context.correlationId,
      reason: context.reason,
    });
  },
  async onRejected(tx, request, context) {
    await lockPending(tx, request.entityId, "reject");
    await changeStatus(
      tx,
      request.entityId,
      "PENDING_APPROVAL",
      "DRAFT",
      "PURCHASE_ORDER_REJECTED",
      {
        employeeId: context.resolverEmployeeId,
        now: context.now,
        correlationId: context.correlationId,
        reason: context.reason,
      },
      { submittedAt: null },
    );
  },
};
