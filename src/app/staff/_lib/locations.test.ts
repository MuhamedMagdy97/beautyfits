import { describe, expect, it } from "vitest";
import type { ShippingRuleView } from "@/server/modules/shipping/shipping-service";
import { ruleBody, ruleForm } from "./locations";
import { LOCATIONS_DICTIONARIES } from "./locations-i18n";

const blank = ruleForm();

describe("shipping rule form", () => {
  it("sends pounds as integer piastres and blanks as null", () => {
    expect(
      ruleBody({ ...blank, shippingFee: "49.5", minOrderTotal: "100", priority: "-3" }),
    ).toEqual({
      body: {
        shippingCompanyId: null,
        governorateId: null,
        areaId: null,
        minOrderTotal: 10000,
        maxOrderTotal: null,
        shippingFee: 4950,
        priority: -3,
        activeFrom: null,
        activeTo: null,
        status: "ACTIVE",
      },
    });
  });

  it("points at the first unreadable field", () => {
    expect(ruleBody(blank)).toEqual({ badField: "shippingFee" });
    expect(ruleBody({ ...blank, shippingFee: "1.234" })).toEqual({ badField: "shippingFee" });
    expect(ruleBody({ ...blank, shippingFee: "5", minOrderTotal: "-1" })).toEqual({
      badField: "minOrderTotal",
    });
    expect(ruleBody({ ...blank, shippingFee: "5", maxOrderTotal: "x" })).toEqual({
      badField: "maxOrderTotal",
    });
    expect(ruleBody({ ...blank, shippingFee: "5", priority: "1.5" })).toEqual({
      badField: "priority",
    });
  });

  it("drops the area when no governorate is chosen", () => {
    const result = ruleBody({ ...blank, shippingFee: "0", areaId: "a" });
    expect(result).toMatchObject({ body: { governorateId: null, areaId: null } });
  });

  it("round-trips an existing rule", () => {
    const rule: ShippingRuleView = {
      id: "r",
      shippingCompanyId: "c",
      governorateId: "g",
      areaId: "a",
      minOrderTotal: 5000,
      maxOrderTotal: 100000,
      shippingFee: 7550,
      priority: 10,
      activeFrom: "2026-11-01T08:00:00.000Z",
      activeTo: null,
      status: "INACTIVE",
      createdAt: "",
      updatedAt: "",
    };
    expect(ruleBody(ruleForm(rule))).toEqual({
      body: {
        shippingCompanyId: "c",
        governorateId: "g",
        areaId: "a",
        minOrderTotal: 5000,
        maxOrderTotal: 100000,
        shippingFee: 7550,
        priority: 10,
        activeFrom: "2026-11-01T08:00:00.000Z",
        activeTo: null,
        status: "INACTIVE",
      },
    });
  });

  it("has the same keys in Arabic and English", () => {
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, inner]) =>
        typeof inner === "object" ? keys(inner as object).map((k) => `${key}.${k}`) : [key],
      );
    expect(keys(LOCATIONS_DICTIONARIES.ar).sort()).toEqual(keys(LOCATIONS_DICTIONARIES.en).sort());
  });
});
