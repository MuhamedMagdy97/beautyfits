import { describe, expect, it } from "vitest";
import {
  marginBasisPoints,
  marginWarnings,
  MAX_TARGET_MARGIN_BASIS_POINTS,
  nextWeightedAverageCost,
  suggestedPrice,
} from "@/server/modules/catalog/pricing";

const egp = (pounds: number) => BigInt(pounds * 100);

describe("margin on the selling price (ADR-0023)", () => {
  it("is (price − cost) / price in basis points", () => {
    expect(marginBasisPoints(egp(100), egp(60))).toBe(4000);
    expect(marginBasisPoints(egp(100), egp(100))).toBe(0);
    expect(marginBasisPoints(egp(100), egp(120))).toBe(-2000);
    expect(marginBasisPoints(egp(100), BigInt(0))).toBe(10_000);
  });

  it("rounds HALF-UP to the basis point (R9)", () => {
    // (3 − 1) / 3 = 66.666…% → 6667 bp; (3 − 2) / 3 = 33.333…% → 3333 bp
    expect(marginBasisPoints(BigInt(3), BigInt(1))).toBe(6667);
    expect(marginBasisPoints(BigInt(3), BigInt(2))).toBe(3333);
    // (8 − 7) / 8 = 12.5% exactly
    expect(marginBasisPoints(BigInt(8), BigInt(7))).toBe(1250);
    // (2 − 1) / 20000 × 10000 = 0.5 bp → 1 (tie rounds up)
    expect(marginBasisPoints(BigInt(20_000), BigInt(19_999))).toBe(1);
  });

  it("refuses a price that is not positive", () => {
    expect(() => marginBasisPoints(BigInt(0), BigInt(0))).toThrow(RangeError);
  });
});

describe("suggested price from a target margin (Q111)", () => {
  it("is cost / (1 − margin)", () => {
    expect(suggestedPrice(egp(60), 4000)).toBe(egp(100));
    expect(suggestedPrice(egp(60), 0)).toBe(egp(60));
  });

  it("rounds HALF-UP to the piastre", () => {
    // 1000 / 0.7 = 1428.571… → 1429
    expect(suggestedPrice(BigInt(1000), 3000)).toBe(BigInt(1429));
    // 1 / 0.5 = 2 exactly; 3 / 0.4 = 7.5 → 8
    expect(suggestedPrice(BigInt(1), 5000)).toBe(BigInt(2));
    expect(suggestedPrice(BigInt(3), 6000)).toBe(BigInt(8));
  });

  it("gives back the target margin, within rounding", () => {
    const price = suggestedPrice(BigInt(12_345), 3500)!;
    expect(Math.abs(marginBasisPoints(price, BigInt(12_345)) - 3500)).toBeLessThanOrEqual(1);
  });

  it("has no suggestion for a zero cost", () => {
    expect(suggestedPrice(BigInt(0), 4000)).toBeNull();
  });

  it("refuses impossible margins and negative costs", () => {
    expect(() => suggestedPrice(egp(10), MAX_TARGET_MARGIN_BASIS_POINTS + 1)).toThrow(RangeError);
    expect(() => suggestedPrice(egp(10), -1)).toThrow(RangeError);
    expect(() => suggestedPrice(egp(10), 12.5)).toThrow(RangeError);
    expect(() => suggestedPrice(BigInt(-1), 1000)).toThrow(RangeError);
    expect(suggestedPrice(BigInt(1), MAX_TARGET_MARGIN_BASIS_POINTS)).toBe(BigInt(10_000));
  });
});

describe("margin warnings (Q102, Q111)", () => {
  const minimum = 1000; // 10%

  it("are empty when the margin reaches the minimum", () => {
    expect(marginWarnings(egp(100), egp(90), minimum)).toEqual([]);
    expect(marginWarnings(egp(100), egp(50), minimum)).toEqual([]);
  });

  it("flag a margin just below the minimum, compared exactly", () => {
    // 9.99% margin
    expect(marginWarnings(BigInt(10_000), BigInt(9001), minimum)).toEqual(["BELOW_MINIMUM_MARGIN"]);
  });

  it("flag a price at or below cost", () => {
    expect(marginWarnings(egp(100), egp(100), minimum)).toEqual([
      "PRICE_NOT_ABOVE_COST",
      "BELOW_MINIMUM_MARGIN",
    ]);
    expect(marginWarnings(egp(100), egp(100), 0)).toEqual(["PRICE_NOT_ABOVE_COST"]);
    expect(marginWarnings(egp(90), egp(100), 0)).toEqual([
      "PRICE_NOT_ABOVE_COST",
      "BELOW_MINIMUM_MARGIN",
    ]);
  });

  it("are empty when the cost is unknown", () => {
    expect(marginWarnings(egp(1), null, minimum)).toEqual([]);
  });
});

describe("weighted average cost (Q103, for goods receipts)", () => {
  it("is the received cost when nothing is on hand or no average exists", () => {
    expect(nextWeightedAverageCost(0, egp(50), 10, egp(60))).toBe(egp(60));
    expect(nextWeightedAverageCost(5, null, 10, egp(60))).toBe(egp(60));
  });

  it("weights by quantity and rounds HALF-UP once", () => {
    expect(nextWeightedAverageCost(10, egp(50), 10, egp(60))).toBe(egp(55));
    // (1 × 100 + 2 × 101) / 3 = 100.666… → 101
    expect(nextWeightedAverageCost(1, BigInt(100), 2, BigInt(101))).toBe(BigInt(101));
    // (1 × 100 + 1 × 101) / 2 = 100.5 → 101
    expect(nextWeightedAverageCost(1, BigInt(100), 1, BigInt(101))).toBe(BigInt(101));
  });

  it("refuses invalid quantities and negative costs", () => {
    expect(() => nextWeightedAverageCost(-1, egp(1), 1, egp(1))).toThrow(RangeError);
    expect(() => nextWeightedAverageCost(1, egp(1), 0, egp(1))).toThrow(RangeError);
    expect(() => nextWeightedAverageCost(1.5, egp(1), 1, egp(1))).toThrow(RangeError);
    expect(() => nextWeightedAverageCost(1, egp(1), 1, BigInt(-1))).toThrow(RangeError);
  });
});
