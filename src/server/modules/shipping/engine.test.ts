import { describe, expect, it } from "vitest";
import {
  quoteShipping,
  type ShippingQuoteInput,
  type ShippingRuleCandidate,
} from "@/server/modules/shipping/engine";

const NOW = new Date("2026-10-04T12:00:00Z");

function rule(id: string, overrides: Partial<ShippingRuleCandidate> = {}): ShippingRuleCandidate {
  return {
    id,
    shippingCompanyId: null,
    governorateId: null,
    areaId: null,
    minOrderTotal: null,
    maxOrderTotal: null,
    shippingFee: BigInt(5000),
    priority: 0,
    activeFrom: null,
    activeTo: null,
    ...overrides,
  };
}

function input(overrides: Partial<ShippingQuoteInput> = {}): ShippingQuoteInput {
  return {
    governorateId: "cairo",
    areaId: "maadi",
    orderTotal: BigInt(100_000),
    freeShippingThreshold: BigInt(250_000),
    now: NOW,
    ...overrides,
  };
}

describe("quoteShipping", () => {
  it("returns null when no rule covers the place (R37)", () => {
    expect(quoteShipping([], input())).toBeNull();
    expect(quoteShipping([rule("a", { governorateId: "giza" })], input())).toBeNull();
    expect(
      quoteShipping([rule("a", { governorateId: "cairo", areaId: "nasr" })], input()),
    ).toBeNull();
  });

  it("prefers area over governorate over everywhere, whatever the priority", () => {
    const everywhere = rule("a", { priority: 100, shippingFee: BigInt(1000) });
    const governorate = rule("b", {
      governorateId: "cairo",
      priority: 50,
      shippingFee: BigInt(9000),
    });
    const area = rule("c", { governorateId: "cairo", areaId: "maadi", shippingFee: BigInt(7000) });
    expect(quoteShipping([everywhere, governorate, area], input())?.rule.id).toBe("c");
    expect(quoteShipping([everywhere, governorate], input())?.rule.id).toBe("b");
    expect(quoteShipping([everywhere], input())).toMatchObject({
      shippingFee: BigInt(1000),
      freeShipping: false,
    });
  });

  it("breaks ties by priority, then fee, then id", () => {
    const low = rule("b", { priority: 1, shippingFee: BigInt(3000) });
    const high = rule("c", { priority: 2, shippingFee: BigInt(9000) });
    expect(quoteShipping([low, high], input())?.rule.id).toBe("c");
    expect(
      quoteShipping([rule("b", { shippingFee: BigInt(4000) }), rule("a")], input())?.rule.id,
    ).toBe("b");
    expect(quoteShipping([rule("b"), rule("a")], input())?.rule.id).toBe("a");
  });

  it("matches order-total bands: minimum inclusive, maximum exclusive", () => {
    const small = rule("small", { maxOrderTotal: BigInt(100_000), shippingFee: BigInt(6000) });
    const large = rule("large", { minOrderTotal: BigInt(100_000), shippingFee: BigInt(4000) });
    expect(quoteShipping([small, large], input({ orderTotal: BigInt(99_999) }))?.rule.id).toBe(
      "small",
    );
    expect(quoteShipping([small, large], input({ orderTotal: BigInt(100_000) }))?.rule.id).toBe(
      "large",
    );
  });

  it("matches the active period: start inclusive, end exclusive", () => {
    const r = rule("a", { activeFrom: NOW, activeTo: new Date(NOW.getTime() + 1000) });
    expect(quoteShipping([r], input())).not.toBeNull();
    expect(quoteShipping([r], input({ now: new Date(NOW.getTime() - 1) }))).toBeNull();
    expect(quoteShipping([r], input({ now: new Date(NOW.getTime() + 1000) }))).toBeNull();
  });

  it("ships free from the threshold, on the total after discounts (Q123)", () => {
    const r = rule("a");
    expect(quoteShipping([r], input({ orderTotal: BigInt(249_999) }))).toMatchObject({
      shippingFee: BigInt(5000),
      freeShipping: false,
    });
    expect(quoteShipping([r], input({ orderTotal: BigInt(250_000) }))).toMatchObject({
      shippingFee: BigInt(0),
      freeShipping: true,
      rule: { id: "a" },
    });
  });
});
