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

/**
 * Allowed status moves so far (User Flows §11.2): the customer withdraws or
 * staff approve/reject a waiting request (TASK-037/038, Q91, Q92); an
 * approved return gets its carrier pickup (Q93); the parcel is received
 * and inspected (TASK-039, Q29, Q94). TASK-040+ add the rest.
 */
const RETURN_TRANSITIONS: Partial<Record<ReturnStatus, readonly ReturnStatus[]>> = {
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PICKUP_SCHEDULED"],
  PICKUP_SCHEDULED: ["RECEIVED"],
  RECEIVED: ["INSPECTING"],
  // TASK-041: completion credits the wallet once the refund is READY.
  INSPECTING: ["COMPLETED"],
};

/**
 * Change of mind (owner decision 2026-10-15): the store is not at fault, so
 * opened items and free gifts cannot be returned. Every other claim type
 * (damaged, wrong, defective, expired, missing) can return them.
 */
export const CHANGE_OF_MIND_CLAIM = "OTHER";

/** A free gift (a zero-price line) cannot be returned on a change of mind. */
export function isNotReturnableLine(claimType: string, unitPrice: bigint): boolean {
  return claimType === CHANGE_OF_MIND_CLAIM && unitPrice === BigInt(0);
}

export type InspectionOutcome = {
  result: "RESTOCK" | "DAMAGED" | "REJECTED";
  condition: "SELLABLE" | "DAMAGED" | "OPENED_USED" | "MISSING_PARTS" | "REJECTED";
  quantity: number;
};

export type InspectionProblem =
  | { kind: "QUANTITY_MISMATCH"; inspected: number; requested: number }
  | { kind: "RESTOCK_NOT_SELLABLE"; index: number }
  | { kind: "OPENED_NOT_RETURNABLE"; index: number };

/**
 * Checks one line's inspection (Q30, Q35, Q36, Q95): every requested unit
 * gets exactly one outcome, and only units found sellable are restocked.
 * On a change of mind, opened units are not returnable: they must be
 * rejected (owner decision 2026-10-15). Returns the first problem, or null.
 */
export function checkInspection(
  requested: number,
  outcomes: readonly InspectionOutcome[],
  claimType?: string,
): InspectionProblem | null {
  const index = outcomes.findIndex((o) => o.result === "RESTOCK" && o.condition !== "SELLABLE");
  if (index >= 0) {
    return { kind: "RESTOCK_NOT_SELLABLE", index };
  }
  if (claimType === CHANGE_OF_MIND_CLAIM) {
    const opened = outcomes.findIndex(
      (o) => o.condition === "OPENED_USED" && o.result !== "REJECTED",
    );
    if (opened >= 0) {
      return { kind: "OPENED_NOT_RETURNABLE", index: opened };
    }
  }
  const inspected = outcomes.reduce((sum, o) => sum + o.quantity, 0);
  return inspected === requested ? null : { kind: "QUANTITY_MISMATCH", inspected, requested };
}

/** Units of a line that go back to Available stock (Q36). */
export function restockQuantity(outcomes: readonly InspectionOutcome[]): number {
  return outcomes.reduce((sum, o) => sum + (o.result === "RESTOCK" ? o.quantity : 0), 0);
}

/** The status a return must be in to move to `to`, or null when `from` may move there. */
export function requiredStatusFor(from: ReturnStatus, to: ReturnStatus): ReturnStatus | null {
  if (RETURN_TRANSITIONS[from]?.includes(to)) {
    return null;
  }
  const source = Object.entries(RETURN_TRANSITIONS).find(([, targets]) => targets.includes(to));
  return (source?.[0] as ReturnStatus | undefined) ?? from;
}

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
