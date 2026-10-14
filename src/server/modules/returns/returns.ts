import type { ReturnStatus } from "@/generated/prisma/client";
import { calendarDayDeadline } from "@/server/time/time";

/**
 * Pure return-request rules (TASK-037, ADR-0049; Business Spec Q17, Q34, R21).
 */

/** Q17: 14 days, final. Not a setting. */
export const RETURN_WINDOW_DAYS = 14;

/** R21: until the end of the 14th calendar day after delivery, Africa/Cairo (exclusive end). */
export function returnWindowEndsAt(deliveredAt: Date): Date {
  return calendarDayDeadline(deliveredAt, RETURN_WINDOW_DAYS);
}

/** Returns that no longer claim their quantities: the customer may ask again (Q92). */
export const RELEASED_RETURN_STATUSES: readonly ReturnStatus[] = ["REJECTED", "CANCELLED"];

/** Returns that still need work, so they block account deactivation (R34). */
export const OPEN_RETURN_STATUSES: readonly ReturnStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "PICKUP_SCHEDULED",
  "RECEIVED",
  "INSPECTING",
  "PARTIALLY_COMPLETED",
];

export type QuantityProblem =
  | { kind: "UNKNOWN_ITEM"; index: number; orderItemId: string }
  | { kind: "TOO_MANY"; orderItemId: string; requested: number; returnable: number };

/**
 * Checks a request against the order's lines (Q34: partial returns). Each
 * line can be returned up to its ordered quantity minus what other live
 * returns already ask for. Returns the first problem, or null.
 */
export function checkReturnQuantities(
  ordered: ReadonlyMap<string, number>,
  alreadyRequested: ReadonlyMap<string, number>,
  requested: readonly { orderItemId: string; quantity: number }[],
): QuantityProblem | null {
  for (const [index, line] of requested.entries()) {
    const quantity = ordered.get(line.orderItemId);
    if (quantity === undefined) {
      return { kind: "UNKNOWN_ITEM", index, orderItemId: line.orderItemId };
    }
    const returnable = quantity - (alreadyRequested.get(line.orderItemId) ?? 0);
    if (line.quantity > returnable) {
      return {
        kind: "TOO_MANY",
        orderItemId: line.orderItemId,
        requested: line.quantity,
        returnable: Math.max(returnable, 0),
      };
    }
  }
  return null;
}
