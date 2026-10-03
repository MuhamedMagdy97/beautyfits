import { describe, expect, it } from "vitest";
import { needsNote, splitDelivery } from "@/server/modules/purchasing/goods-receipts";

describe("splitDelivery (Q115, Q116)", () => {
  it("receives a short delivery as it is (100 ordered, 97 delivered)", () => {
    const split = splitDelivery({ ordered: 100, alreadyReceived: 0, delivered: 97, damaged: 0 });
    expect(split).toEqual({ accepted: 97, damaged: 0, overDelivery: 0 });
    expect(needsNote(split as never, 100)).toBe(true);
  });

  it("holds back extras beyond the ordered quantity (100 ordered, 105 delivered)", () => {
    expect(splitDelivery({ ordered: 100, alreadyReceived: 0, delivered: 105, damaged: 0 })).toEqual(
      {
        accepted: 100,
        damaged: 0,
        overDelivery: 5,
      },
    );
  });

  it("counts damaged units against what is due", () => {
    expect(splitDelivery({ ordered: 10, alreadyReceived: 4, delivered: 8, damaged: 2 })).toEqual({
      accepted: 4,
      damaged: 2,
      overDelivery: 2,
    });
  });

  it("treats everything as extra once the order is complete", () => {
    expect(splitDelivery({ ordered: 10, alreadyReceived: 10, delivered: 3, damaged: 0 })).toEqual({
      accepted: 0,
      damaged: 0,
      overDelivery: 3,
    });
  });

  it("refuses damaged units beyond the delivery or what is due", () => {
    expect(splitDelivery({ ordered: 10, alreadyReceived: 0, delivered: 2, damaged: 3 })).toEqual({
      problem: "DAMAGED_EXCEEDS_DELIVERED",
    });
    expect(splitDelivery({ ordered: 10, alreadyReceived: 9, delivered: 3, damaged: 2 })).toEqual({
      problem: "DAMAGED_EXCEEDS_DUE",
    });
  });

  it("needs no note when exactly what was due arrives in good condition", () => {
    const split = splitDelivery({ ordered: 10, alreadyReceived: 4, delivered: 6, damaged: 0 });
    expect(needsNote(split as never, 6)).toBe(false);
  });
});
