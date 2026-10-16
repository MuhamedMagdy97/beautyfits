import type { PermissionCode } from "@/server/modules/rbac/catalog";

/**
 * Pure helpers of the orders and returns screens (TASK-054). They mirror the
 * API contract tables so the right button is offered; the API still decides
 * and its refusal is shown (ADR-0063).
 */

export interface StatusStep {
  /** `POST /admin/orders/{id}/<path>` or `/admin/returns/{id}/<path>`. */
  path: string;
  permission: PermissionCode;
}

/** The staff step out of each order status (API "TASK-030/031 Amendments"). */
const ORDER_STEPS: Record<string, StatusStep> = {
  PENDING_CONFIRMATION: {
    path: "record-phone-confirmation",
    permission: "RECORD_COD_CONFIRMATION",
  },
  NEW: { path: "confirm", permission: "CONFIRM_ORDER" },
  CONFIRMED: { path: "start-preparing", permission: "START_PREPARING" },
  PREPARING: { path: "mark-ready-for-shipment", permission: "MARK_READY_FOR_SHIPMENT" },
};

export function orderStep(status: string): StatusStep | null {
  return ORDER_STEPS[status] ?? null;
}

/** The simple return steps without a form beyond notes (API "TASK-038/039 Amendments"). */
const RETURN_STEPS: Record<string, StatusStep> = {
  PICKUP_SCHEDULED: { path: "receive", permission: "RECEIVE_RETURN" },
  RECEIVED: { path: "start-inspection", permission: "INSPECT_RETURN" },
};

export function returnStep(status: string): StatusStep | null {
  return RETURN_STEPS[status] ?? null;
}

/** A `{ nameAr, nameEn }` snapshot (governorate, area) in the current language. */
export function snapshotPlace(value: unknown, english: boolean): string {
  if (!value || typeof value !== "object") return "";
  const place = value as { nameAr?: string | null; nameEn?: string | null };
  return (english ? (place.nameEn ?? place.nameAr) : (place.nameAr ?? place.nameEn)) ?? "";
}

export interface OutcomeRow {
  result: string;
  condition: string;
  quantity: string;
  notes: string;
}

/**
 * Inspection rows as the API body (API "TASK-039 Amendments"), or the
 * expected quantity when the rows do not add up to it. Other checks
 * (restock needs sellable, change of mind) stay with the API.
 */
export function inspectionOutcomes(
  rows: readonly OutcomeRow[],
  requestedQuantity: number,
):
  | { outcomes: { result: string; condition: string; quantity: number; notes?: string }[] }
  | { mismatch: number } {
  const outcomes = rows.map((row) => ({
    result: row.result,
    condition: row.condition,
    quantity: /^\d+$/.test(row.quantity.trim()) ? Number(row.quantity.trim()) : 0,
    ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
  }));
  const sum = outcomes.reduce((total, outcome) => total + outcome.quantity, 0);
  if (sum !== requestedQuantity || outcomes.some((outcome) => outcome.quantity < 1)) {
    return { mismatch: requestedQuantity };
  }
  return { outcomes };
}

/** Every line of the return has its inspection (assessment may be recorded, TASK-040). */
export function allInspected(items: readonly { inspection: unknown }[]): boolean {
  return items.every((item) => item.inspection !== null);
}

/**
 * The line waits for its R7 decision (TASK-040): the return is assessed as
 * customer-caused, the line has damaged units and no decision yet.
 */
export function needsResolution(
  line: {
    inspection: { outcomes: readonly { result: string }[] } | null;
    resolution: unknown;
  },
  finalResponsibility: string | undefined,
): boolean {
  return (
    finalResponsibility === "CUSTOMER" &&
    line.resolution === null &&
    (line.inspection?.outcomes.some((outcome) => outcome.result === "DAMAGED") ?? false)
  );
}
