import { describe, expect, it } from "vitest";
import { checkReturnQuantities, returnWindowEndsAt } from "@/server/modules/returns/returns";

describe("returnWindowEndsAt (R21)", () => {
  it("ends at Cairo midnight after the 14th calendar day; the delivery day is day 0", () => {
    // 2026-10-01 23:30 Cairo (UTC+3) is still 1 October locally.
    expect(returnWindowEndsAt(new Date("2026-10-01T20:30:00Z")).toISOString()).toBe(
      "2026-10-15T21:00:00.000Z",
    );
  });
});

describe("checkReturnQuantities (Q34)", () => {
  const ordered = new Map([
    ["a", 3],
    ["b", 1],
  ]);

  it("allows a partial return up to what is left", () => {
    expect(
      checkReturnQuantities(ordered, new Map([["a", 1]]), [{ orderItemId: "a", quantity: 2 }]),
    ).toBeNull();
  });

  it("refuses more than is left and unknown lines", () => {
    expect(
      checkReturnQuantities(ordered, new Map([["a", 2]]), [{ orderItemId: "a", quantity: 2 }]),
    ).toEqual({ kind: "TOO_MANY", orderItemId: "a", requested: 2, returnable: 1 });
    expect(
      checkReturnQuantities(ordered, new Map(), [
        { orderItemId: "b", quantity: 1 },
        { orderItemId: "x", quantity: 1 },
      ]),
    ).toEqual({ kind: "UNKNOWN_ITEM", index: 1, orderItemId: "x" });
  });
});
