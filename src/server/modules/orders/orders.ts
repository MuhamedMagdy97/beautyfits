import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { AuditActor } from "@/server/modules/audit/audit";

/**
 * The order state machine (Business Spec R1–R4, R11; User Flows §8; API §15
 * "Order Rules"; ADR-0036). Every status change goes through
 * `changeOrderStatus`, so arbitrary jumps are impossible and each change
 * leaves one `order_status_history` row.
 *
 * - `PENDING_CONFIRMATION → NEW` only by the System after COD confirmation (R1, R10).
 * - `EXPIRED` only from `PENDING_CONFIRMATION` (COD timeout, Q25).
 * - Direct cancellation before carrier pickup (R11); `SHIPPED → CANCELLED`
 *   only after the shipment came back (R3, TASK-036).
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_CONFIRMATION: ["NEW", "CANCELLED", "EXPIRED"],
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_FOR_SHIPMENT", "CANCELLED"],
  READY_FOR_SHIPMENT: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** Not yet finished: counts as an open order (R34). */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_SHIPMENT",
  "SHIPPED",
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function orderNotFound(): AppError {
  return new AppError("NOT_FOUND", "Order not found.");
}

/** Locks the order row and returns its status. */
export async function lockOrder(tx: Db, orderId: string): Promise<OrderStatus> {
  const rows = await tx.$queryRaw<{ status: OrderStatus }[]>`
    SELECT status FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  if (rows.length === 0) {
    throw orderNotFound();
  }
  return rows[0].status;
}

/**
 * Locks the order, checks the transition and moves it to `to` with its
 * history row, in the caller's transaction. `data` sets lifecycle columns
 * (timestamps) of that transition. Returns the previous status.
 */
export async function changeOrderStatus(
  tx: Db,
  input: {
    orderId: string;
    to: OrderStatus;
    actor: AuditActor;
    now: Date;
    reason?: string | null;
    data?: Prisma.OrderUpdateInput;
  },
): Promise<OrderStatus> {
  const from = await lockOrder(tx, input.orderId);
  if (!canTransition(from, input.to)) {
    throw new AppError("ORDER_STATE_INVALID", `An order in ${from} cannot move to ${input.to}.`, {
      details: { status: from, to: input.to },
    });
  }
  await tx.order.update({
    where: { id: input.orderId },
    data: { ...input.data, status: input.to, updatedAt: input.now },
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId: input.orderId,
      fromStatus: from,
      toStatus: input.to,
      changedByType: input.actor.type,
      changedById: input.actor.id ?? null,
      reason: input.reason ?? null,
      createdAt: input.now,
    },
  });
  return from;
}
