import { describe, expect, it } from "vitest";
import {
  evaluateDiscount,
  withSubcategories,
  type DiscountLine,
  type DiscountRule,
  type DiscountUsageCounts,
} from "@/server/modules/discounts/engine";

const NOW = new Date("2026-10-04T12:00:00Z");

function rule(overrides: Partial<DiscountRule> = {}): DiscountRule {
  return {
    status: "ACTIVE",
    value: 20,
    scope: "STORE_WIDE",
    maxDiscountAmount: null,
    minimumOrderTotal: null,
    startsAt: new Date("2026-10-01T00:00:00Z"),
    endsAt: null,
    usageLimitTotal: null,
    usageLimitPerCustomer: null,
    productIds: new Set(),
    categoryIds: new Set(),
    brandIds: new Set(),
    ...overrides,
  };
}

function line(productId: string, lineTotal: number | null, extra: Partial<DiscountLine> = {}) {
  return {
    productId,
    brandId: null,
    categoryIds: [],
    lineTotal: lineTotal === null ? null : BigInt(lineTotal),
    ...extra,
  };
}

const GUEST: DiscountUsageCounts = { total: 0, customer: null };

describe("evaluateDiscount", () => {
  it("takes the percentage of purchasable lines, HALF-UP, capped (Q134, R9)", () => {
    const lines = [line("a", 10_001), line("b", null)];
    expect(evaluateDiscount(rule({ value: 15 }), lines, GUEST, NOW)).toEqual({
      ok: true,
      amount: BigInt(1500), // 15% of 100.01 = 15.0015 → 15.00
      eligibleSubtotal: BigInt(10_001),
    });
    expect(evaluateDiscount(rule({ value: 25 }), [line("a", 10)], GUEST, NOW)).toMatchObject({
      amount: BigInt(3), // 2.5 → 3
    });
    const capped = rule({ value: 50, maxDiscountAmount: BigInt(1000) });
    expect(evaluateDiscount(capped, lines, GUEST, NOW)).toMatchObject({ amount: BigInt(1000) });
  });

  it("applies a targeted discount to matching lines only, minimum on the whole subtotal", () => {
    const targeted = rule({
      scope: "TARGETED",
      brandIds: new Set(["brand"]),
      categoryIds: new Set(["cat"]),
      productIds: new Set(["p"]),
      minimumOrderTotal: BigInt(30_000),
    });
    const lines = [
      line("p", 10_000),
      line("x", 10_000, { brandId: "brand" }),
      line("y", 10_000, { categoryIds: ["other", "cat"] }),
      line("z", 10_000),
    ];
    expect(evaluateDiscount(targeted, lines, GUEST, NOW)).toMatchObject({
      eligibleSubtotal: BigInt(30_000),
      amount: BigInt(6_000),
    });
    expect(evaluateDiscount(targeted, lines.slice(0, 2), GUEST, NOW)).toEqual({
      ok: false,
      problem: "MINIMUM_NOT_MET",
    });
    // Q137: an unavailable targeted product does not count.
    expect(evaluateDiscount(targeted, [line("p", null), line("z", 40_000)], GUEST, NOW)).toEqual({
      ok: false,
      problem: "NO_ELIGIBLE_ITEMS",
    });
  });

  it("reports why a discount does not apply", () => {
    const lines = [line("a", 10_000)];
    const cases: [Partial<DiscountRule>, DiscountUsageCounts, string][] = [
      [{ status: "INACTIVE" }, GUEST, "INACTIVE"],
      [{ startsAt: new Date("2026-10-05T00:00:00Z") }, GUEST, "NOT_STARTED"],
      [{ endsAt: NOW }, GUEST, "ENDED"],
      [{ usageLimitTotal: 3 }, { total: 3, customer: 0 }, "USAGE_LIMIT_REACHED"],
      [{ usageLimitPerCustomer: 1 }, GUEST, "SIGN_IN_REQUIRED"],
      [{ usageLimitPerCustomer: 1 }, { total: 1, customer: 1 }, "CUSTOMER_LIMIT_REACHED"],
    ];
    for (const [overrides, usage, problem] of cases) {
      expect(evaluateDiscount(rule(overrides), lines, usage, NOW)).toEqual({ ok: false, problem });
    }
    expect(
      evaluateDiscount(rule({ usageLimitPerCustomer: 2 }), lines, { total: 9, customer: 1 }, NOW)
        .ok,
    ).toBe(true);
    expect(evaluateDiscount(rule(), [], GUEST, NOW)).toEqual({
      ok: false,
      problem: "NO_ELIGIBLE_ITEMS",
    });
  });
});

describe("withSubcategories", () => {
  it("adds every descendant category", () => {
    const tree = [
      { id: "skin", parentId: null },
      { id: "face", parentId: "skin" },
      { id: "serum", parentId: "face" },
      { id: "hair", parentId: null },
    ];
    expect([...withSubcategories(["skin"], tree)].sort()).toEqual(["face", "serum", "skin"]);
    expect([...withSubcategories(["face", "hair"], tree)].sort()).toEqual([
      "face",
      "hair",
      "serum",
    ]);
  });
});
