import { allocate, basisPointsOf, roundHalfUp } from "@/server/money/money";

/**
 * Pure refund rules of a customer return (TASK-040, ADR-0066; Business Spec
 * Q29, Q96–Q99, C2, C3, R7, R9; User Flows §11.5–§11.6).
 *
 * - A unit refunds what was actually paid for it: its share of the order
 *   line total, which is already net of the line's discount share (ADR-0035).
 * - Restocked units refund in full; rejected units refund nothing.
 * - Damaged units refund in full when BeautyFits or the carrier is
 *   responsible; when the customer is, they are the R7 exception: sent back
 *   with no refund, or kept with the configured share refunded.
 * - The original delivery fee is refunded only when BeautyFits or the
 *   carrier is responsible (C3), once per order.
 * TASK-041 completes the return and credits the wallet from this result.
 */

export type ReturnResponsibility = "CUSTOMER" | "BEAUTYFITS" | "CARRIER" | "UNDETERMINED";
export type CustomerCausedResolution = "RETURN_TO_CUSTOMER" | "KEEP_PARTIAL_REFUND";

export interface RefundLineInput {
  returnItemId: string;
  /** Units of the order line, and its total after the discount share. */
  orderedQuantity: number;
  lineTotal: bigint;
  /** Units of the same order line in earlier live returns of the order. */
  priorQuantity: number;
  quantity: number;
  /** Inspection outcomes; empty while the line is not inspected. */
  outcomes: readonly { result: "RESTOCK" | "DAMAGED" | "REJECTED"; quantity: number }[];
  resolution: { resolution: CustomerCausedResolution; basisPoints: number | null } | null;
}

export interface RefundInput {
  responsibility: ReturnResponsibility;
  lines: readonly RefundLineInput[];
  orderShippingFee: bigint;
  /** Another return of the order already takes the delivery fee. */
  deliveryFeeTakenElsewhere: boolean;
}

export type RefundStatus =
  "INSPECTION_REQUIRED" | "ASSESSMENT_REQUIRED" | "RESOLUTION_REQUIRED" | "READY";

export interface RefundLine {
  returnItemId: string;
  quantity: number;
  /** What was paid for these units. */
  paidAmount: bigint;
  restockQuantity: number;
  damagedQuantity: number;
  rejectedQuantity: number;
  /** Damaged units the customer is responsible for (R7). */
  customerCausedQuantity: number;
  /** Null until inspected, assessed and (for R7) resolved. */
  refundAmount: bigint | null;
  /** The part of the R7 units' paid amount kept back when BeautyFits keeps them. */
  deductionAmount: bigint;
}

export interface RefundCalculation {
  status: RefundStatus;
  lines: RefundLine[];
  productRefund: bigint | null;
  deliveryFeeRefund: bigint | null;
  totalRefund: bigint | null;
}

const ZERO = BigInt(0);

/**
 * What was paid for `quantity` units of a line when `prior` units were
 * already returned: cumulative HALF-UP shares (R9), so the returns of one
 * line never add up to more than its total.
 */
export function paidForUnits(
  lineTotal: bigint,
  orderedQuantity: number,
  prior: number,
  quantity: number,
): bigint {
  const ordered = BigInt(orderedQuantity);
  return (
    roundHalfUp(lineTotal * BigInt(prior + quantity), ordered) -
    roundHalfUp(lineTotal * BigInt(prior), ordered)
  );
}

function sumOf(outcomes: RefundLineInput["outcomes"], result: string): number {
  return outcomes.reduce((sum, o) => sum + (o.result === result ? o.quantity : 0), 0);
}

function lineRefund(line: RefundLineInput, responsibility: ReturnResponsibility): RefundLine {
  const paidAmount = paidForUnits(
    line.lineTotal,
    line.orderedQuantity,
    line.priorQuantity,
    line.quantity,
  );
  const restockQuantity = sumOf(line.outcomes, "RESTOCK");
  const damagedQuantity = sumOf(line.outcomes, "DAMAGED");
  const rejectedQuantity = sumOf(line.outcomes, "REJECTED");
  const customerCausedQuantity = responsibility === "CUSTOMER" ? damagedQuantity : 0;
  const base = {
    returnItemId: line.returnItemId,
    quantity: line.quantity,
    paidAmount,
    restockQuantity,
    damagedQuantity,
    rejectedQuantity,
    customerCausedQuantity,
    deductionAmount: ZERO,
  };
  if (line.outcomes.length === 0 || responsibility === "UNDETERMINED") {
    return { ...base, refundAmount: null };
  }
  const [restockAmount, damagedAmount] = allocate(paidAmount, [
    BigInt(restockQuantity),
    BigInt(damagedQuantity),
    BigInt(rejectedQuantity),
  ]);
  if (customerCausedQuantity === 0) {
    return { ...base, refundAmount: restockAmount + damagedAmount };
  }
  if (!line.resolution) {
    return { ...base, refundAmount: null };
  }
  if (line.resolution.resolution === "RETURN_TO_CUSTOMER") {
    return { ...base, refundAmount: restockAmount };
  }
  const partial = basisPointsOf(damagedAmount, line.resolution.basisPoints ?? 0);
  return {
    ...base,
    refundAmount: restockAmount + partial,
    deductionAmount: damagedAmount - partial,
  };
}

export function calculateRefund(input: RefundInput): RefundCalculation {
  const lines = input.lines.map((line) => lineRefund(line, input.responsibility));
  const status: RefundStatus = input.lines.some((l) => l.outcomes.length === 0)
    ? "INSPECTION_REQUIRED"
    : input.responsibility === "UNDETERMINED"
      ? "ASSESSMENT_REQUIRED"
      : lines.some((l) => l.refundAmount === null)
        ? "RESOLUTION_REQUIRED"
        : "READY";
  if (status !== "READY") {
    return { status, lines, productRefund: null, deliveryFeeRefund: null, totalRefund: null };
  }
  const productRefund = lines.reduce((sum, l) => sum + (l.refundAmount ?? ZERO), ZERO);
  const deliveryFeeRefund =
    input.responsibility !== "CUSTOMER" && !input.deliveryFeeTakenElsewhere
      ? input.orderShippingFee
      : ZERO;
  return {
    status,
    lines,
    productRefund,
    deliveryFeeRefund,
    totalRefund: productRefund + deliveryFeeRefund,
  };
}

/**
 * A completed return's refund as fixed at completion (TASK-041, ADR-0068):
 * the stored line amounts and total replace the live calculation, which can
 * still move by a piastre when an earlier return of the line is released.
 * The delivery fee refund is the stored total minus the stored line refunds.
 */
export function withFixedAmounts(
  calculation: RefundCalculation,
  refundTotal: bigint,
  stored: readonly { refundEligibleAmount: bigint | null; deductionAmount: bigint | null }[],
): RefundCalculation {
  const lines = calculation.lines.map((line, index) => ({
    ...line,
    refundAmount: stored[index].refundEligibleAmount ?? ZERO,
    deductionAmount: stored[index].deductionAmount ?? ZERO,
  }));
  const productRefund = lines.reduce((sum, l) => sum + l.refundAmount, ZERO);
  return {
    status: "READY",
    lines,
    productRefund,
    deliveryFeeRefund: refundTotal - productRefund,
    totalRefund: refundTotal,
  };
}

/**
 * Who should pay the carrier for the pickup (C2): the customer for
 * customer-caused returns, BeautyFits otherwise; null until assessed.
 */
export function finalPickupFeePayer(
  responsibility: ReturnResponsibility,
): "CUSTOMER" | "BEAUTYFITS" | null {
  if (responsibility === "UNDETERMINED") {
    return null;
  }
  return responsibility === "CUSTOMER" ? "CUSTOMER" : "BEAUTYFITS";
}
