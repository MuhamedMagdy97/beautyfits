import { describe, expect, it } from "vitest";
import {
  checkInspection,
  isNotReturnableLine,
  checkReturnQuantities,
  requiredStatusFor,
  restockQuantity,
  returnWindowEndsAt,
} from "@/server/modules/returns/returns";
import { createReturnSchema } from "@/server/modules/returns/schemas";

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

  it("receives a picked-up parcel, then inspects it (TASK-039)", () => {
    expect(requiredStatusFor("PICKUP_SCHEDULED", "RECEIVED")).toBeNull();
    expect(requiredStatusFor("RECEIVED", "INSPECTING")).toBeNull();
    expect(requiredStatusFor("APPROVED", "RECEIVED")).toBe("PICKUP_SCHEDULED");
    expect(requiredStatusFor("PICKUP_SCHEDULED", "INSPECTING")).toBe("RECEIVED");
    expect(requiredStatusFor("INSPECTING", "RECEIVED")).toBe("PICKUP_SCHEDULED");
  });
});

describe("checkInspection (Q30, Q35, Q36)", () => {
  const restock = { result: "RESTOCK", condition: "SELLABLE", quantity: 2 } as const;
  const damaged = { result: "DAMAGED", condition: "OPENED_USED", quantity: 1 } as const;

  it("splits a line's units across outcomes", () => {
    expect(checkInspection(3, [restock, damaged])).toBeNull();
    expect(restockQuantity([restock, damaged])).toBe(2);
    expect(restockQuantity([damaged])).toBe(0);
  });

  it("needs every unit inspected once and restocks only sellable units", () => {
    expect(checkInspection(2, [restock, damaged])).toEqual({
      kind: "QUANTITY_MISMATCH",
      inspected: 3,
      requested: 2,
    });
    expect(checkInspection(3, [restock])).toMatchObject({ kind: "QUANTITY_MISMATCH" });
    expect(
      checkInspection(3, [damaged, { result: "RESTOCK", condition: "DAMAGED", quantity: 2 }]),
    ).toEqual({ kind: "RESTOCK_NOT_SELLABLE", index: 1 });
  });
  it("rejects opened units on a change of mind only (owner decision 2026-10-15)", () => {
    expect(checkInspection(3, [restock, damaged], "OTHER")).toEqual({
      kind: "OPENED_NOT_RETURNABLE",
      index: 1,
    });
    const rejected = { result: "REJECTED", condition: "OPENED_USED", quantity: 1 } as const;
    expect(checkInspection(3, [restock, rejected], "OTHER")).toBeNull();
    expect(checkInspection(3, [restock, damaged], "DEFECTIVE")).toBeNull();
  });
});

describe("isNotReturnableLine (owner decision 2026-10-15)", () => {
  it("refuses free gifts on a change of mind only", () => {
    expect(isNotReturnableLine("OTHER", BigInt(0))).toBe(true);
    expect(isNotReturnableLine("OTHER", BigInt(15000))).toBe(false);
    expect(isNotReturnableLine("DAMAGED", BigInt(0))).toBe(false);
    expect(isNotReturnableLine("MISSING_ITEM", BigInt(0))).toBe(false);
  });
});

describe("createReturnSchema evidence (Q100, owner decision 2026-10-15)", () => {
  const base = {
    reason: "Problem",
    items: [{ orderItemId: "019a0000-0000-7000-8000-000000000001", quantity: 1 }],
  };

  it("needs a photo for damaged, wrong, defective and expired items only", () => {
    for (const claimType of ["DAMAGED", "WRONG_ITEM", "DEFECTIVE", "EXPIRED"]) {
      expect(createReturnSchema.safeParse({ ...base, claimType }).success).toBe(false);
    }
    for (const claimType of ["MISSING_ITEM", "OTHER"]) {
      expect(createReturnSchema.safeParse({ ...base, claimType }).success).toBe(true);
    }
  });
});
