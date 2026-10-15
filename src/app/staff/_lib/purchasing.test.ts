import { describe, expect, it } from "vitest";
import { StaffApiError } from "./api";
import { CATALOG_DICTIONARIES, catalogError } from "./catalog-i18n";
import { DICTIONARIES } from "./i18n";
import { findSection, visibleNav } from "./navigation";
import { countField, formatPurchaseLines, parsePurchaseLines, snapshotName } from "./purchasing";
import { fill, PURCHASING_DICTIONARIES } from "./purchasing-i18n";

describe("purchase lines", () => {
  it("reads SKU, quantity and unit cost in pounds into integer piastres", () => {
    expect(parsePurchaseLines("LIP-01, 12, 45.50\n\n  EYE-2,1,7 ")).toEqual({
      lines: [
        { sku: "LIP-01", quantity: 12, unitCost: 4550 },
        { sku: "EYE-2", quantity: 1, unitCost: 700 },
      ],
    });
  });

  it("points at the first line it cannot read", () => {
    expect(parsePurchaseLines("")).toEqual({ badLine: 1 });
    expect(parsePurchaseLines("A, 1, 2\nB, 0, 2")).toEqual({ badLine: 2 });
    for (const bad of [
      "A, 1",
      "A, x, 2",
      "A, 1, -2",
      "A, 1, 0",
      "A, 1, 1.234",
      ", 1, 2",
      "A, 1.5, 2",
    ]) {
      expect(parsePurchaseLines(bad)).toEqual({ badLine: 1 });
    }
  });

  it("formats a draft's lines back into the same text", () => {
    const text = formatPurchaseLines([
      { sku: "LIP-01", orderedQuantity: 12, unitCost: 4550 },
      { sku: "EYE-2", orderedQuantity: 1, unitCost: 700 },
    ]);
    expect(text).toBe("LIP-01, 12, 45.50\nEYE-2, 1, 7.00");
    expect(parsePurchaseLines(text)).toEqual({
      lines: [
        { sku: "LIP-01", quantity: 12, unitCost: 4550 },
        { sku: "EYE-2", quantity: 1, unitCost: 700 },
      ],
    });
  });
});

describe("form helpers", () => {
  it("reads whole-number counts, blank as zero", () => {
    expect(countField("")).toBe(0);
    expect(countField(" 3 ")).toBe(3);
    expect(countField("-1")).toBeNull();
    expect(countField("1.5")).toBeNull();
  });

  it("shows order snapshot names in the current language", () => {
    expect(snapshotName({ ar: "أحمر", en: "Red" }, true)).toBe("Red");
    expect(snapshotName({ ar: "أحمر", en: "Red" }, false)).toBe("أحمر");
    expect(snapshotName({ ar: null, en: "Red" }, false)).toBe("Red");
    expect(snapshotName(null, true)).toBe("");
  });

  it("fills placeholders and leaves unknown ones", () => {
    expect(fill("Line {n}: {x}", { n: 2 })).toBe("Line 2: {x}");
  });
});

describe("purchasing texts", () => {
  it("has the same keys in Arabic and English", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(PURCHASING_DICTIONARIES.ar)).toEqual(keys(PURCHASING_DICTIONARIES.en));
    expect(keys(CATALOG_DICTIONARIES.ar.statuses)).toEqual(keys(CATALOG_DICTIONARIES.en.statuses));
    expect(keys(CATALOG_DICTIONARIES.ar.conflicts)).toEqual(
      keys(CATALOG_DICTIONARIES.en.conflicts),
    );
  });

  it("localizes purchasing and shipping conflict reasons", () => {
    const error = new StaffApiError(409, "CONFLICT", { reason: "INVOICE_REQUIRED" });
    expect(catalogError(DICTIONARIES.ar, CATALOG_DICTIONARIES.ar, error)).toBe(
      CATALOG_DICTIONARIES.ar.conflicts.INVOICE_REQUIRED,
    );
    expect(
      catalogError(
        DICTIONARIES.en,
        CATALOG_DICTIONARIES.en,
        new StaffApiError(409, "CONFLICT", { reason: "SHIPPING_CANCELLATION_REQUIRED" }),
      ),
    ).toBe(CATALOG_DICTIONARIES.en.conflicts.SHIPPING_CANCELLATION_REQUIRED);
  });
});

describe("navigation for purchasing and shipping staff", () => {
  it("shows purchases to receiving staff and shipping to those who act on shipments", () => {
    expect(findSection("purchases")?.anyOf).toContain("RECEIVE_PURCHASE");
    const slugs = visibleNav(["RECEIVE_PURCHASE", "INSPECT_RETURN"]).flatMap((group) =>
      group.sections.map((section) => section.slug),
    );
    expect(slugs).toEqual(["shipping", "purchases"]);
  });
});
