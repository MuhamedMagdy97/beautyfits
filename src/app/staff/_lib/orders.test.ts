import { describe, expect, it } from "vitest";
import { StaffApiError } from "./api";
import { CATALOG_DICTIONARIES } from "./catalog-i18n";
import { DICTIONARIES } from "./i18n";
import {
  allInspected,
  inspectionOutcomes,
  needsResolution,
  orderStep,
  returnStep,
  snapshotPlace,
} from "./orders";
import { accountLabel, ORDERS_DICTIONARIES, ordersError } from "./orders-i18n";

const en = { t: DICTIONARIES.en, c: CATALOG_DICTIONARIES.en, o: ORDERS_DICTIONARIES.en };

describe("status steps", () => {
  it("offers the staff step of each order status with its permission", () => {
    expect(orderStep("PENDING_CONFIRMATION")).toEqual({
      path: "record-phone-confirmation",
      permission: "RECORD_COD_CONFIRMATION",
    });
    expect(orderStep("NEW")?.path).toBe("confirm");
    expect(orderStep("CONFIRMED")?.path).toBe("start-preparing");
    expect(orderStep("PREPARING")?.permission).toBe("MARK_READY_FOR_SHIPMENT");
    for (const status of ["READY_FOR_SHIPMENT", "SHIPPED", "DELIVERED", "CANCELLED", "EXPIRED"]) {
      expect(orderStep(status)).toBeNull();
    }
  });

  it("offers receive and start inspection on returns", () => {
    expect(returnStep("PICKUP_SCHEDULED")).toEqual({
      path: "receive",
      permission: "RECEIVE_RETURN",
    });
    expect(returnStep("RECEIVED")).toEqual({
      path: "start-inspection",
      permission: "INSPECT_RETURN",
    });
    expect(returnStep("INSPECTING")).toBeNull();
    expect(returnStep("COMPLETED")).toBeNull();
  });
});

describe("inspection outcomes", () => {
  const row = (quantity: string, notes = "") => ({
    result: "RESTOCK",
    condition: "SELLABLE",
    quantity,
    notes,
  });

  it("builds the API body when the quantities add up to the returned units", () => {
    expect(inspectionOutcomes([row("2", " ok "), row("1")], 3)).toEqual({
      outcomes: [
        { result: "RESTOCK", condition: "SELLABLE", quantity: 2, notes: "ok" },
        { result: "RESTOCK", condition: "SELLABLE", quantity: 1 },
      ],
    });
  });

  it("refuses sums that differ, blanks, zero and non-numbers", () => {
    expect(inspectionOutcomes([row("2")], 3)).toEqual({ mismatch: 3 });
    expect(inspectionOutcomes([row("3"), row("0")], 3)).toEqual({ mismatch: 3 });
    expect(inspectionOutcomes([row("1.5"), row("1.5")], 3)).toEqual({ mismatch: 3 });
    expect(inspectionOutcomes([row("")], 1)).toEqual({ mismatch: 1 });
  });
});

describe("assessment and R7 (TASK-054A)", () => {
  const inspected = (...results: string[]) => ({
    outcomes: results.map((result) => ({ result })),
  });

  it("offers the assessment only once every line is inspected", () => {
    expect(allInspected([{ inspection: inspected("RESTOCK") }])).toBe(true);
    expect(allInspected([{ inspection: inspected("RESTOCK") }, { inspection: null }])).toBe(false);
  });

  it("asks for an R7 decision on damaged lines of customer-caused returns only", () => {
    const damaged = { inspection: inspected("RESTOCK", "DAMAGED"), resolution: null };
    expect(needsResolution(damaged, "CUSTOMER")).toBe(true);
    expect(needsResolution(damaged, "BEAUTYFITS")).toBe(false);
    expect(needsResolution(damaged, undefined)).toBe(false);
    expect(needsResolution({ ...damaged, resolution: {} }, "CUSTOMER")).toBe(false);
    const rejected = { inspection: inspected("RESTOCK", "REJECTED"), resolution: null };
    expect(needsResolution(rejected, "CUSTOMER")).toBe(false);
    expect(needsResolution({ inspection: null, resolution: null }, "CUSTOMER")).toBe(false);
  });
});

describe("snapshots", () => {
  it("shows governorate and area names in the current language", () => {
    const place = { nameAr: "القاهرة", nameEn: "Cairo" };
    expect(snapshotPlace(place, true)).toBe("Cairo");
    expect(snapshotPlace(place, false)).toBe("القاهرة");
    expect(snapshotPlace({ nameAr: null, nameEn: "Cairo" }, false)).toBe("Cairo");
    expect(snapshotPlace(undefined, true)).toBe("");
  });
});

describe("orders texts", () => {
  it("has the same keys in Arabic and English", () => {
    const { ar, en: english } = ORDERS_DICTIONARIES;
    const keys = (value: object) => Object.keys(value).sort();
    expect(keys(ar)).toEqual(keys(english));
    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      if (typeof english[key] === "object") {
        expect(keys(ar[key] as object), key).toEqual(keys(english[key] as object));
      }
    }
  });

  it("localizes state refusals with the status label", () => {
    expect(
      ordersError(
        en.t,
        en.c,
        en.o,
        new StaffApiError(409, "ORDER_STATE_INVALID", { status: "SHIPPED", to: "CONFIRMED" }),
      ),
    ).toBe("This action is not allowed in the current status (Shipped).");
    expect(
      ordersError(
        en.t,
        en.c,
        en.o,
        new StaffApiError(409, "RETURN_STATE_INVALID", { status: "PICKUP_SCHEDULED" }),
      ),
    ).toBe("This action is not allowed in the current status (Pickup scheduled).");
  });

  it("localizes cancellation and inspection refusals, else falls back to the shared wording", () => {
    expect(
      ordersError(
        en.t,
        en.c,
        en.o,
        new StaffApiError(422, "ORDER_CANCELLATION_NOT_ALLOWED", {
          status: "SHIPPED",
          reason: "AFTER_CARRIER_PICKUP",
        }),
      ),
    ).toBe(en.c.conflicts.AFTER_CARRIER_PICKUP);
    expect(
      ordersError(
        en.t,
        en.c,
        en.o,
        new StaffApiError(422, "ORDER_CANCELLATION_NOT_ALLOWED", { status: "DELIVERED" }),
      ),
    ).toBe("This order can no longer be cancelled (Delivered).");
    expect(
      ordersError(
        en.t,
        en.c,
        en.o,
        new StaffApiError(409, "CONFLICT", { reason: "RETURN_ITEM_ALREADY_INSPECTED" }),
      ),
    ).toBe(en.o.conflicts.RETURN_ITEM_ALREADY_INSPECTED);
    expect(ordersError(en.t, en.c, en.o, new StaffApiError(403, "PERMISSION_DENIED"))).toBe(
      en.t.errors.PERMISSION_DENIED,
    );
  });

  it("labels the customer's account state", () => {
    expect(accountLabel(en.o, { accountStatus: "ACTIVE", anonymized: false })).toBe("Active");
    expect(accountLabel(en.o, { accountStatus: null, anonymized: false })).toBe("No account");
    expect(accountLabel(en.o, { accountStatus: "DEACTIVATED", anonymized: true })).toBe(
      "Deleted by the customer",
    );
  });
});
