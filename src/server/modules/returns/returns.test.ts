import { describe, expect, it } from "vitest";
import {
  checkReturnQuantities,
  requiredStatusFor,
  returnWindowEndsAt,
} from "@/server/modules/returns/returns";

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

describe("requiredStatusFor (User Flows §11.2)", () => {
  it("allows review of a waiting request and pickup of an approved one", () => {
    expect(requiredStatusFor("PENDING_APPROVAL", "APPROVED")).toBeNull();
    expect(requiredStatusFor("PENDING_APPROVAL", "REJECTED")).toBeNull();
    expect(requiredStatusFor("PENDING_APPROVAL", "CANCELLED")).toBeNull();
    expect(requiredStatusFor("APPROVED", "PICKUP_SCHEDULED")).toBeNull();
  });

  it("names the status a move needs", () => {
    expect(requiredStatusFor("APPROVED", "REJECTED")).toBe("PENDING_APPROVAL");
    expect(requiredStatusFor("REJECTED", "APPROVED")).toBe("PENDING_APPROVAL");
    expect(requiredStatusFor("APPROVED", "CANCELLED")).toBe("PENDING_APPROVAL");
    expect(requiredStatusFor("PENDING_APPROVAL", "PICKUP_SCHEDULED")).toBe("APPROVED");
    expect(requiredStatusFor("PICKUP_SCHEDULED", "PICKUP_SCHEDULED")).toBe("APPROVED");
  });
});
