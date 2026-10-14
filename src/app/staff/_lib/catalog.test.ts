import { describe, expect, it } from "vitest";
import { StaffApiError } from "./api";
import { CATALOG_DICTIONARIES, catalogError } from "./catalog-i18n";
import { DICTIONARIES } from "./i18n";
import { formatAttributes, optionalInt, parseAttributes } from "./forms";
import { formatBasisPoints, formatPiastres, parsePounds } from "./money";

describe("money", () => {
  it("formats piastres as pounds without floating point", () => {
    expect(formatPiastres(19999)).toBe("199.99");
    expect(formatPiastres(5)).toBe("0.05");
    expect(formatPiastres(-250)).toBe("-2.50");
    expect(formatPiastres(null)).toBeNull();
    expect(formatBasisPoints(4000)).toBe("40.00%");
  });

  it("parses typed pounds into piastres and refuses anything else", () => {
    expect(parsePounds("199.99")).toBe(19999);
    expect(parsePounds(" 12.5 ")).toBe(1250);
    expect(parsePounds("7")).toBe(700);
    expect(parsePounds("0.1")).toBe(10);
    for (const bad of ["", "-1", "1.234", "1,5", "abc", "1e3", ".5"]) {
      expect(parsePounds(bad)).toBeNull();
    }
  });
});

describe("catalogError", () => {
  const t = DICTIONARIES.en;
  const c = CATALOG_DICTIONARIES.en;

  it("localizes conflict reasons and lists missing publish requirements", () => {
    const error = new StaffApiError(409, "CONFLICT", {
      reason: "PUBLISH_REQUIREMENTS_NOT_MET",
      missing: ["MAIN_IMAGE", "SELLING_PRICE"],
    });
    expect(catalogError(t, c, error)).toBe(
      "The product cannot be published yet. Missing: a main image, a selling price on every active variant.",
    );
    expect(catalogError(t, c, new StaffApiError(409, "CONFLICT", { reason: "SKU_TAKEN" }))).toBe(
      c.conflicts.SKU_TAKEN,
    );
  });

  it("falls back to a generic conflict and to the shell messages", () => {
    expect(catalogError(t, c, new StaffApiError(409, "CONFLICT", { reason: "NEW" }))).toBe(
      c.conflict,
    );
    expect(catalogError(t, c, new StaffApiError(404, "NOT_FOUND"))).toBe(c.notFound);
    expect(catalogError(t, c, new StaffApiError(403, "PERMISSION_DENIED"))).toBe(
      t.errors.PERMISSION_DENIED,
    );
    expect(catalogError(t, c, new Error("x"))).toBe(t.errors.default);
  });
});

describe("form helpers", () => {
  it("round-trips attributes and treats blank as none", () => {
    expect(parseAttributes("shade: Red\n\n size : 30 ml: big \nflag")).toEqual({
      shade: "Red",
      size: "30 ml: big",
      flag: "",
    });
    expect(parseAttributes("  \n")).toBeNull();
    expect(formatAttributes({ shade: "Red" })).toBe("shade: Red");
    expect(formatAttributes(null)).toBe("");
  });

  it("reads optional whole numbers and leaves bad input for the API to refuse", () => {
    expect(optionalInt("")).toBeNull();
    expect(optionalInt(" 12 ")).toBe(12);
    expect(optionalInt("1.5")).toBe("1.5");
  });
});
