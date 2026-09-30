import { z } from "zod";

/**
 * Money helpers (ADR-0011; Business Spec R5, R9, R22).
 *
 * Amounts are integer minor units (EGP piastres) held as `bigint`, matching
 * the `BigInt` money columns (ADR-0003). There is no floating-point path:
 * derived amounts (percentages, tax, partial refunds, weighted averages) are
 * computed as exact fractions and rounded once, HALF-UP, by `roundHalfUp`.
 * This is the only rounding implementation in the backend.
 */

export type MinorUnits = bigint;

/** The only supported currency (EGP). Stored next to every money column. */
export const CURRENCY = "EGP";
export type Currency = typeof CURRENCY;

/** Minor units per major unit: 100 piastres = 1 EGP. */
export const MINOR_PER_MAJOR = BigInt(100);

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);
const BASIS_POINTS_PER_WHOLE = BigInt(10_000);

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Converts an integer amount of minor units to `bigint`. Accepts a bigint, a
 * safe integer number, or an integer string. Fractions, NaN, Infinity and
 * unsafe integers are rejected, so a float can never become money.
 */
export function toMinor(value: bigint | number | string): MinorUnits {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Money must be a safe integer of minor units, got ${value}`);
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new RangeError(`Money must be an integer string of minor units, got "${value}"`);
  }
  return BigInt(value);
}

/** Serializes minor units for JSON API payloads (API contract §2 principle 3). */
export function toJsonNumber(amount: MinorUnits): number {
  if (amount > MAX_SAFE || amount < MIN_SAFE) {
    throw new RangeError(`Money amount ${amount} cannot be represented exactly in JSON`);
  }
  return Number(amount);
}

/** API input: an integer number of minor units, transformed to `bigint`. */
export const minorUnitsSchema = z.int().transform((value) => BigInt(value));

export function add(...amounts: MinorUnits[]): MinorUnits {
  return amounts.reduce((total, amount) => total + amount, ZERO);
}

export function subtract(amount: MinorUnits, other: MinorUnits): MinorUnits {
  return amount - other;
}

/** Multiplies by an integer factor, e.g. unit price × quantity. */
export function multiply(amount: MinorUnits, factor: bigint | number): MinorUnits {
  return amount * toInteger(factor, "factor");
}

export function compare(a: MinorUnits, b: MinorUnits): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Divides `numerator / denominator` and rounds to the nearest integer with
 * HALF-UP: ties round away from zero (2.5 → 3, -2.5 → -3; R9, R22).
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === ZERO) {
    throw new RangeError("Division by zero");
  }
  const negative = numerator < ZERO !== denominator < ZERO;
  const n = numerator < ZERO ? -numerator : numerator;
  const d = denominator < ZERO ? -denominator : denominator;
  let quotient = n / d;
  if ((n % d) * TWO >= d) {
    quotient += ONE;
  }
  return negative ? -quotient : quotient;
}

/** `amount × numerator / denominator`, computed exactly and rounded once, HALF-UP. */
export function multiplyRatio(
  amount: MinorUnits,
  numerator: bigint | number,
  denominator: bigint | number,
): MinorUnits {
  return roundHalfUp(
    amount * toInteger(numerator, "numerator"),
    toInteger(denominator, "denominator"),
  );
}

/**
 * `percent`% of `amount`, rounded HALF-UP. `percent` is a decimal string
 * ("25", "12.5", "14") or an integer, never a float, so it stays exact.
 */
export function percentOf(amount: MinorUnits, percent: string | bigint | number): MinorUnits {
  const { numerator, denominator } = parseDecimal(percent);
  return roundHalfUp(amount * numerator, denominator * HUNDRED);
}

/** `basisPoints` / 10,000 of `amount` (1 bp = 0.01%), rounded HALF-UP. */
export function basisPointsOf(amount: MinorUnits, basisPoints: bigint | number): MinorUnits {
  return multiplyRatio(amount, basisPoints, BASIS_POINTS_PER_WHOLE);
}

/**
 * Parses a major-unit amount ("199.99", "-5", "0.5") into minor units.
 * At most two decimal places; anything else is rejected rather than rounded.
 */
export function parseMajor(value: string): MinorUnits {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new RangeError(`Invalid money amount "${value}"`);
  }
  const [, sign, whole, fraction = ""] = match;
  const minor = BigInt(whole) * MINOR_PER_MAJOR + BigInt(fraction.padEnd(2, "0"));
  return sign ? -minor : minor;
}

/** Formats minor units as a plain major-unit string ("199.99"), e.g. for exports. */
export function formatMajor(amount: MinorUnits): string {
  const negative = amount < ZERO;
  const abs = negative ? -amount : amount;
  const whole = abs / MINOR_PER_MAJOR;
  const fraction = (abs % MINOR_PER_MAJOR).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function toInteger(value: bigint | number, name: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${value}`);
  }
  return BigInt(value);
}

/** Parses an exact decimal ("12.5") into a fraction with a power-of-ten denominator. */
function parseDecimal(value: string | bigint | number): { numerator: bigint; denominator: bigint } {
  if (typeof value !== "string") {
    return { numerator: toInteger(value, "percent"), denominator: ONE };
  }
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    throw new RangeError(`Invalid decimal "${value}"`);
  }
  const [, sign, whole, fraction = ""] = match;
  const numerator = BigInt(whole + fraction);
  return {
    numerator: sign ? -numerator : numerator,
    denominator: TEN ** BigInt(fraction.length),
  };
}
