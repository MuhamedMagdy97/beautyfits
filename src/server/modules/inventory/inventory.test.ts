import { describe, expect, it } from "vitest";
import {
  adjustmentDeltas,
  applyDeltas,
  effectiveThreshold,
  isLowStock,
} from "@/server/modules/inventory/inventory";
import { adjustInventorySchema } from "@/server/modules/inventory/schemas";

describe("adjustmentDeltas", () => {
  it("corrects Available up or down", () => {
    expect(adjustmentDeltas("MANUAL_ADJUSTMENT", 5)).toEqual({
      availableDelta: 5,
      reservedDelta: 0,
      damagedDelta: 0,
    });
    expect(adjustmentDeltas("MANUAL_ADJUSTMENT", -3).availableDelta).toBe(-3);
  });

  it("moves Available to Damaged and writes Damaged off; Reserved never changes", () => {
    expect(adjustmentDeltas("DAMAGE", 2)).toEqual({
      availableDelta: -2,
      reservedDelta: 0,
      damagedDelta: 2,
    });
    expect(adjustmentDeltas("DAMAGE_WRITE_OFF", 2)).toEqual({
      availableDelta: 0,
      reservedDelta: 0,
      damagedDelta: -2,
    });
  });

  it("refuses zero, fractions and negative damage quantities", () => {
    expect(() => adjustmentDeltas("MANUAL_ADJUSTMENT", 0)).toThrow(RangeError);
    expect(() => adjustmentDeltas("MANUAL_ADJUSTMENT", 1.5)).toThrow(RangeError);
    expect(() => adjustmentDeltas("DAMAGE", -1)).toThrow(RangeError);
    expect(() => adjustmentDeltas("DAMAGE_WRITE_OFF", -1)).toThrow(RangeError);
  });
});

describe("applyDeltas", () => {
  const current = { available: 3, reserved: 1, damaged: 0 };

  it("returns the new quantities", () => {
    expect(applyDeltas(current, adjustmentDeltas("DAMAGE", 3))).toEqual({
      ok: true,
      next: { available: 0, reserved: 1, damaged: 3 },
    });
  });

  it("names the quantity that would go below zero", () => {
    expect(applyDeltas(current, adjustmentDeltas("MANUAL_ADJUSTMENT", -4))).toEqual({
      ok: false,
      short: "available",
    });
    expect(applyDeltas(current, adjustmentDeltas("DAMAGE_WRITE_OFF", 1))).toEqual({
      ok: false,
      short: "damaged",
    });
  });
});

describe("low stock", () => {
  it("uses the variant threshold, else the product's", () => {
    expect(effectiveThreshold(2, 10)).toBe(2);
    expect(effectiveThreshold(0, 10)).toBe(0);
    expect(effectiveThreshold(null, 10)).toBe(10);
    expect(effectiveThreshold(null, null)).toBeNull();
  });

  it("is at or below the threshold, only while on sale, never without a threshold", () => {
    expect(isLowStock(5, 5, true)).toBe(true);
    expect(isLowStock(6, 5, true)).toBe(false);
    expect(isLowStock(0, 0, true)).toBe(true);
    expect(isLowStock(0, null, true)).toBe(false);
    expect(isLowStock(0, 5, false)).toBe(false);
  });
});

describe("adjustInventorySchema", () => {
  it("requires a reason and a non-zero whole quantity", () => {
    expect(adjustInventorySchema.safeParse({ type: "DAMAGE", quantity: 1 }).success).toBe(false);
    expect(
      adjustInventorySchema.safeParse({ type: "DAMAGE", quantity: 1, reason: "  " }).success,
    ).toBe(false);
    for (const quantity of [0, 1.5, 1_000_001]) {
      expect(
        adjustInventorySchema.safeParse({ type: "MANUAL_ADJUSTMENT", quantity, reason: "Count" })
          .success,
      ).toBe(false);
    }
  });

  it("takes a signed quantity only for MANUAL_ADJUSTMENT", () => {
    expect(
      adjustInventorySchema.safeParse({ type: "MANUAL_ADJUSTMENT", quantity: -2, reason: "Count" })
        .success,
    ).toBe(true);
    expect(
      adjustInventorySchema.safeParse({ type: "DAMAGE", quantity: -2, reason: "Count" }).success,
    ).toBe(false);
  });

  it("refuses movement types reserved for other workflows", () => {
    expect(
      adjustInventorySchema.safeParse({ type: "PURCHASE_RECEIPT", quantity: 2, reason: "x" })
        .success,
    ).toBe(false);
  });
});
