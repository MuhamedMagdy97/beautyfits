import type { InventoryMovementType } from "@/generated/prisma/client";

/**
 * Inventory rules (TASK-019, Business Spec Q21, Q71, Q72, Q108, Q109,
 * ADR-0024). Pure functions; `inventory-service.ts` applies them.
 *
 * - Available is sellable; Reserved and Damaged are not (Q109).
 * - Stock changes only through inventory movements; each carries a delta per
 *   quantity, and the database applies it to the balance.
 * - A manual adjustment corrects Available up or down, moves Available to
 *   Damaged, or writes Damaged off. Reserved is never adjusted by hand.
 */

export type ManualMovementType = Extract<
  InventoryMovementType,
  "MANUAL_ADJUSTMENT" | "DAMAGE" | "DAMAGE_WRITE_OFF"
>;

export interface Quantities {
  available: number;
  reserved: number;
  damaged: number;
}

export interface Deltas {
  availableDelta: number;
  reservedDelta: number;
  damagedDelta: number;
}

/**
 * The deltas of a manual adjustment. `quantity` is signed for
 * MANUAL_ADJUSTMENT and positive for DAMAGE and DAMAGE_WRITE_OFF.
 */
export function adjustmentDeltas(type: ManualMovementType, quantity: number): Deltas {
  if (!Number.isSafeInteger(quantity) || quantity === 0) {
    throw new RangeError(`Invalid adjustment quantity ${quantity}`);
  }
  if (type !== "MANUAL_ADJUSTMENT" && quantity < 0) {
    throw new RangeError(`${type} takes a positive quantity`);
  }
  switch (type) {
    case "MANUAL_ADJUSTMENT":
      return { availableDelta: quantity, reservedDelta: 0, damagedDelta: 0 };
    case "DAMAGE":
      return { availableDelta: -quantity, reservedDelta: 0, damagedDelta: quantity };
    case "DAMAGE_WRITE_OFF":
      return { availableDelta: 0, reservedDelta: 0, damagedDelta: -quantity };
  }
}

/** The quantities after `deltas`, or the first one that would go below zero. */
export function applyDeltas(
  current: Quantities,
  deltas: Deltas,
): { ok: true; next: Quantities } | { ok: false; short: keyof Quantities } {
  const next = {
    available: current.available + deltas.availableDelta,
    reserved: current.reserved + deltas.reservedDelta,
    damaged: current.damaged + deltas.damagedDelta,
  };
  for (const key of ["available", "reserved", "damaged"] as const) {
    if (next[key] < 0) {
      return { ok: false, short: key };
    }
  }
  return { ok: true, next };
}

/** The variant's own threshold, else its product's (Q21; ADR-0024). Null: no alert. */
export function effectiveThreshold(
  variantThreshold: number | null,
  productThreshold: number | null,
): number | null {
  return variantThreshold ?? productThreshold;
}

/**
 * Low stock: Available at or below the threshold (API §22). Only for variants
 * still on sale: archived variants and products never alert.
 */
export function isLowStock(available: number, threshold: number | null, onSale: boolean): boolean {
  return onSale && threshold !== null && available <= threshold;
}
