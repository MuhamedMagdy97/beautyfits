import { roundHalfUp, type MinorUnits } from "@/server/money/money";

/**
 * Pricing and cost rules (TASK-018, Business Spec Q102, Q103, Q111, ADR-0023).
 * Pure functions; `pricing-service.ts` applies them inside transactions.
 *
 * - Margin is on the selling price: (price − cost) / price, on the
 *   tax-inclusive price as stored (C1). Percentages are basis points
 *   (1 bp = 0.01%), so every value stays an exact integer.
 * - The cost basis for margins and warnings is the latest purchase cost
 *   (Q103); the weighted average cost is for valuation and COGS.
 * - Derived amounts are computed exactly and rounded once, HALF-UP (R9).
 */

export const BASIS_POINTS_PER_WHOLE = 10_000;
const WHOLE = BigInt(BASIS_POINTS_PER_WHOLE);
const ZERO = BigInt(0);

/** The highest target margin: 100% would need an infinite price. */
export const MAX_TARGET_MARGIN_BASIS_POINTS = BASIS_POINTS_PER_WHOLE - 1;

/** Margin of `price` over `cost` in basis points, rounded HALF-UP; negative below cost. */
export function marginBasisPoints(price: MinorUnits, cost: MinorUnits): number {
  if (price <= ZERO) {
    throw new RangeError("A selling price must be positive");
  }
  return Number(roundHalfUp((price - cost) * WHOLE, price));
}

/**
 * The selling price that gives `targetBasisPoints` margin over `cost`:
 * cost / (1 − margin), rounded HALF-UP to the piastre (Q111 suggestion).
 * Null when the result is not a positive price (a zero cost).
 */
export function suggestedPrice(cost: MinorUnits, targetBasisPoints: number): MinorUnits | null {
  if (
    !Number.isSafeInteger(targetBasisPoints) ||
    targetBasisPoints < 0 ||
    targetBasisPoints > MAX_TARGET_MARGIN_BASIS_POINTS
  ) {
    throw new RangeError(`Invalid target margin ${targetBasisPoints}`);
  }
  if (cost < ZERO) {
    throw new RangeError("A cost cannot be negative");
  }
  const price = roundHalfUp(cost * WHOLE, WHOLE - BigInt(targetBasisPoints));
  return price > ZERO ? price : null;
}

export type MarginWarning = "PRICE_NOT_ABOVE_COST" | "BELOW_MINIMUM_MARGIN";

/**
 * Selling-price review warnings (Q102, Q111; ADR-0023 §4 item 2). Compared
 * exactly, without rounding the margin. Warnings never block a change.
 */
export function marginWarnings(
  price: MinorUnits,
  cost: MinorUnits | null,
  minimumBasisPoints: number,
): MarginWarning[] {
  if (cost === null) {
    return [];
  }
  const warnings: MarginWarning[] = [];
  if (price <= cost) {
    warnings.push("PRICE_NOT_ABOVE_COST");
  }
  // (price − cost) / price < minimum / 10,000, without division.
  if ((price - cost) * WHOLE < BigInt(minimumBasisPoints) * price) {
    warnings.push("BELOW_MINIMUM_MARGIN");
  }
  return warnings;
}

/**
 * The weighted average unit cost after receiving `receivedQuantity` units at
 * `unitCost` on top of `onHandQuantity` units valued at `currentAverage`
 * (Q103), rounded HALF-UP. With nothing on hand or no average yet, it is the
 * received unit cost. For the goods receipt task (TASK-023), which decides
 * how negative stock is treated: a negative on-hand quantity is refused here.
 */
export function nextWeightedAverageCost(
  onHandQuantity: number,
  currentAverage: MinorUnits | null,
  receivedQuantity: number,
  unitCost: MinorUnits,
): MinorUnits {
  if (!Number.isSafeInteger(onHandQuantity) || onHandQuantity < 0) {
    throw new RangeError(`Invalid on-hand quantity ${onHandQuantity}`);
  }
  if (!Number.isSafeInteger(receivedQuantity) || receivedQuantity <= 0) {
    throw new RangeError(`Invalid received quantity ${receivedQuantity}`);
  }
  if (unitCost < ZERO || (currentAverage !== null && currentAverage < ZERO)) {
    throw new RangeError("A cost cannot be negative");
  }
  if (onHandQuantity === 0 || currentAverage === null) {
    return unitCost;
  }
  const onHand = BigInt(onHandQuantity);
  const received = BigInt(receivedQuantity);
  return roundHalfUp(onHand * currentAverage + received * unitCost, onHand + received);
}
