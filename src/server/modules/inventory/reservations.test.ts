import { describe, expect, it } from "vitest";
import { mergeLines, shortLines } from "@/server/modules/inventory/reservations";

const A = "0190a0a0-0000-7000-8000-00000000000a";
const B = "0190a0a0-0000-7000-8000-00000000000b";

describe("mergeLines", () => {
  it("sums repeated variants and sorts by variant id (the lock order)", () => {
    expect(
      mergeLines([
        { variantId: B, quantity: 1 },
        { variantId: A.toUpperCase(), quantity: 2 },
        { variantId: A, quantity: 3 },
      ]),
    ).toEqual([
      { variantId: A, quantity: 5 },
      { variantId: B, quantity: 1 },
    ]);
  });

  it("refuses no lines and non-positive or fractional quantities", () => {
    expect(() => mergeLines([])).toThrow(RangeError);
    for (const quantity of [0, -1, 1.5]) {
      expect(() => mergeLines([{ variantId: A, quantity }])).toThrow(RangeError);
    }
  });
});

describe("shortLines", () => {
  it("returns the lines asking for more than is available", () => {
    const available = new Map([
      [A, 2],
      [B, 0],
    ]);
    expect(
      shortLines(
        [
          { variantId: A, quantity: 2 },
          { variantId: B, quantity: 1 },
        ],
        available,
      ),
    ).toEqual([{ variantId: B, quantity: 1 }]);
    expect(shortLines([{ variantId: A, quantity: 3 }], available)).toHaveLength(1);
  });
});
