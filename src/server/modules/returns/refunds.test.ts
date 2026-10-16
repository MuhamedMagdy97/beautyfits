import { describe, expect, it } from "vitest";
import {
  calculateRefund,
  finalPickupFeePayer,
  paidForUnits,
  withFixedAmounts,
  type RefundLineInput,
} from "@/server/modules/returns/refunds";

/** Refund rules (TASK-040; Q97, Q98, C2, C3, R7, R9). */

const B = BigInt;

function line(overrides: Partial<RefundLineInput> = {}): RefundLineInput {
  return {
    returnItemId: "line-1",
    orderedQuantity: 3,
    lineTotal: B(30000),
    priorQuantity: 0,
    quantity: 3,
    outcomes: [{ result: "RESTOCK", quantity: 3 }],
    resolution: null,
    ...overrides,
  };
}

function calc(lines: RefundLineInput[], responsibility: "BEAUTYFITS" | "CUSTOMER" = "BEAUTYFITS") {
  return calculateRefund({
    responsibility,
    lines,
    orderShippingFee: B(5000),
    deliveryFeeTakenElsewhere: false,
  });
}

describe("paidForUnits", () => {
  it("splits a line total by units, HALF-UP, never adding up to more than the total", () => {
    // 100.01 EGP for 3 units: 33.34 + 33.33 + 33.34.
    expect(paidForUnits(B(10001), 3, 0, 1)).toBe(B(3334));
    expect(paidForUnits(B(10001), 3, 1, 1)).toBe(B(3333));
    expect(paidForUnits(B(10001), 3, 2, 1)).toBe(B(3334));
    expect(paidForUnits(B(10001), 3, 0, 3)).toBe(B(10001));
  });
});

describe("calculateRefund", () => {
  it("refunds restocked units in full and the delivery fee when BeautyFits is at fault (C3)", () => {
    const result = calc([line()]);
    expect(result).toMatchObject({
      status: "READY",
      productRefund: B(30000),
      deliveryFeeRefund: B(5000),
      totalRefund: B(35000),
    });
  });

  it("refunds the net of the discount share: the line total (ADR-0035)", () => {
    // 3 × 100 EGP with a 15 EGP discount share: 285 EGP paid.
    const result = calc([line({ lineTotal: B(28500), quantity: 1 })], "CUSTOMER");
    expect(result.productRefund).toBe(B(9500));
    expect(result.deliveryFeeRefund).toBe(B(0));
  });

  it("keeps the delivery fee for customer-caused returns and when another return took it", () => {
    expect(calc([line()], "CUSTOMER").totalRefund).toBe(B(30000));
    const twice = calculateRefund({
      responsibility: "CARRIER",
      lines: [line()],
      orderShippingFee: B(5000),
      deliveryFeeTakenElsewhere: true,
    });
    expect(twice.deliveryFeeRefund).toBe(B(0));
  });

  it("refunds nothing for rejected units", () => {
    const result = calc(
      [
        line({
          outcomes: [
            { result: "RESTOCK", quantity: 2 },
            { result: "REJECTED", quantity: 1 },
          ],
        }),
      ],
      "CUSTOMER",
    );
    expect(result.productRefund).toBe(B(20000));
  });

  it("refunds damaged units in full when the carrier is responsible", () => {
    const result = calculateRefund({
      responsibility: "CARRIER",
      lines: [line({ outcomes: [{ result: "DAMAGED", quantity: 3 }] })],
      orderShippingFee: B(5000),
      deliveryFeeTakenElsewhere: false,
    });
    expect(result.totalRefund).toBe(B(35000));
  });

  it("needs the R7 resolution for customer-caused damaged units", () => {
    const damaged = line({
      outcomes: [
        { result: "RESTOCK", quantity: 2 },
        { result: "DAMAGED", quantity: 1 },
      ],
    });
    const pending = calc([damaged], "CUSTOMER");
    expect(pending.status).toBe("RESOLUTION_REQUIRED");
    expect(pending.totalRefund).toBeNull();
    expect(pending.lines[0]).toMatchObject({ customerCausedQuantity: 1, refundAmount: null });

    const sentBack = calc(
      [{ ...damaged, resolution: { resolution: "RETURN_TO_CUSTOMER", basisPoints: null } }],
      "CUSTOMER",
    );
    expect(sentBack.lines[0]).toMatchObject({ refundAmount: B(20000), deductionAmount: B(0) });

    const kept = calc(
      [{ ...damaged, resolution: { resolution: "KEEP_PARTIAL_REFUND", basisPoints: 2500 } }],
      "CUSTOMER",
    );
    // 25% of the 100 EGP paid for the damaged unit.
    expect(kept.lines[0]).toMatchObject({ refundAmount: B(22500), deductionAmount: B(7500) });
    expect(kept.totalRefund).toBe(B(22500));
  });

  it("rounds the R7 share HALF-UP (R9)", () => {
    const kept = calc(
      [
        line({
          orderedQuantity: 1,
          quantity: 1,
          lineTotal: B(10002),
          outcomes: [{ result: "DAMAGED", quantity: 1 }],
          resolution: { resolution: "KEEP_PARTIAL_REFUND", basisPoints: 2500 },
        }),
      ],
      "CUSTOMER",
    );
    // 25% of 100.02 = 25.005 → 25.01.
    expect(kept.lines[0]).toMatchObject({ refundAmount: B(2501), deductionAmount: B(7501) });
  });

  it("waits for inspection, then for the assessment", () => {
    expect(calc([line({ outcomes: [] })]).status).toBe("INSPECTION_REQUIRED");
    const unassessed = calculateRefund({
      responsibility: "UNDETERMINED",
      lines: [line()],
      orderShippingFee: B(5000),
      deliveryFeeTakenElsewhere: false,
    });
    expect(unassessed).toMatchObject({ status: "ASSESSMENT_REQUIRED", totalRefund: null });
  });
});

describe("finalPickupFeePayer (C2)", () => {
  it("is the customer only for customer-caused returns", () => {
    expect(finalPickupFeePayer("CUSTOMER")).toBe("CUSTOMER");
    expect(finalPickupFeePayer("BEAUTYFITS")).toBe("BEAUTYFITS");
    expect(finalPickupFeePayer("CARRIER")).toBe("BEAUTYFITS");
    expect(finalPickupFeePayer("UNDETERMINED")).toBeNull();
  });
});

describe("withFixedAmounts (TASK-041)", () => {
  it("reports the amounts stored at completion instead of a drifted calculation", () => {
    // 2 of 3 units of a 100 EGP line: 66.67 EGP live; 66.66 EGP was fixed at completion.
    const live = calc([
      line({ lineTotal: B(10000), quantity: 2, outcomes: [{ result: "RESTOCK", quantity: 2 }] }),
    ]);
    expect(live.totalRefund).toBe(B(11667));
    const fixed = withFixedAmounts(live, B(11666), [
      { refundEligibleAmount: B(6666), deductionAmount: B(0) },
    ]);
    expect(fixed).toMatchObject({
      status: "READY",
      productRefund: B(6666),
      deliveryFeeRefund: B(5000),
      totalRefund: B(11666),
    });
    expect(fixed.lines[0]).toMatchObject({ refundAmount: B(6666), deductionAmount: B(0) });
  });
});
