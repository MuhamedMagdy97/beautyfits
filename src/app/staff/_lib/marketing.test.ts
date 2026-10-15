import { describe, expect, it } from "vitest";
import { StaffApiError } from "./api";
import { DICTIONARIES } from "./i18n";
import {
  discountBody,
  discountForm,
  fromLocalInput,
  idempotencyKeyFor,
  parseUuid,
  segmentDefinition,
  segmentForm,
  toLocalInput,
} from "./marketing";
import { MARKETING_DICTIONARIES, marketingError } from "./marketing-i18n";

describe("discount form", () => {
  const filled = {
    ...discountForm(),
    code: " summer10 ",
    nameAr: "صيف",
    nameEn: "Summer",
    value: "10",
    maxDiscount: "50.5",
    minimumOrder: "",
    startsAt: "2026-11-01T10:00",
    usageTotal: "100",
  };

  it("sends pounds as integer piastres and blanks as null", () => {
    const result = discountBody({ ...filled, scope: "TARGETED", brandIds: ["b1"] });
    expect(result).toEqual({
      body: expect.objectContaining({
        code: "summer10",
        value: 10,
        maxDiscountAmount: 5050,
        minimumOrderTotal: null,
        startsAt: new Date("2026-11-01T10:00").toISOString(),
        endsAt: null,
        usageLimitTotal: 100,
        usageLimitPerCustomer: null,
        brandIds: ["b1"],
      }),
    });
  });

  it("sends no targets for a store-wide discount and null for a blank code", () => {
    const result = discountBody({ ...filled, code: " ", productIds: ["p1"] });
    expect(result).toMatchObject({ body: { code: null, scope: "STORE_WIDE", productIds: [] } });
  });

  it("refuses unreadable amounts and a missing start", () => {
    expect(discountBody({ ...filled, maxDiscount: "1,5" })).toEqual({ error: "badAmount" });
    expect(discountBody({ ...filled, startsAt: "" })).toEqual({ error: "badDate" });
  });

  it("round-trips a stored discount", () => {
    const form = discountForm({
      id: "d1",
      code: "X10",
      nameAr: "أ",
      nameEn: "A",
      type: "PERCENTAGE",
      value: 10,
      scope: "STORE_WIDE",
      productIds: [],
      categoryIds: [],
      brandIds: [],
      maxDiscountAmount: 2500,
      minimumOrderTotal: null,
      startsAt: "2026-11-01T08:00:00.000Z",
      endsAt: null,
      usageLimitTotal: null,
      usageLimitPerCustomer: 1,
      status: "INACTIVE",
      usedCount: 0,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(form).toMatchObject({ maxDiscount: "25.00", usagePerCustomer: "1", value: "10" });
    expect(fromLocalInput(form.startsAt)).toBe("2026-11-01T08:00:00.000Z");
    expect(toLocalInput(null)).toBe("");
  });
});

describe("segment builder", () => {
  it("builds each TASK-047 segment type and waits while incomplete", () => {
    const base = segmentForm();
    expect(segmentDefinition(base)).toEqual({ type: "ALL_OPTED_IN", channel: "EMAIL" });
    expect(segmentDefinition({ ...base, type: "PRODUCT_BUYERS" })).toBeNull();
    expect(
      segmentDefinition({ ...base, type: "BRAND_BUYERS", channel: "WHATSAPP", brandIds: ["b"] }),
    ).toEqual({ type: "BRAND_BUYERS", channel: "WHATSAPP", brandIds: ["b"] });
    expect(segmentDefinition({ ...base, type: "INACTIVE", inactiveDays: "90" })).toEqual({
      type: "INACTIVE",
      channel: "EMAIL",
      inactiveDays: 90,
    });
    expect(segmentDefinition({ ...base, type: "INACTIVE", inactiveDays: "0" })).toBeNull();
    expect(segmentDefinition({ ...base, type: "HIGH_SPENDING", minSpent: "1000" })).toEqual({
      type: "HIGH_SPENDING",
      channel: "EMAIL",
      minSpent: 100000,
    });
    expect(segmentDefinition({ ...base, type: "HIGH_SPENDING", minSpent: "abc" })).toBeNull();
  });

  it("reads a stored segment back into the form", () => {
    const form = segmentForm({ type: "HIGH_SPENDING", channel: "WHATSAPP", minSpent: 150050 });
    expect(form).toMatchObject({ type: "HIGH_SPENDING", channel: "WHATSAPP", minSpent: "1500.50" });
    expect(segmentDefinition(form)).toEqual({
      type: "HIGH_SPENDING",
      channel: "WHATSAPP",
      minSpent: 150050,
    });
  });
});

describe("wallet adjustment helpers", () => {
  it("keeps the idempotency key while the same body is retried", () => {
    let n = 0;
    const next = () => `key-${++n}`;
    const body = { direction: "CREDIT", amount: 500, reason: "Goodwill" };
    const first = idempotencyKeyFor(null, body, next);
    expect(idempotencyKeyFor(first, { ...body }, next)).toBe(first);
    expect(idempotencyKeyFor(first, { ...body, amount: 600 }, next).key).toBe("key-2");
  });

  it("accepts only a UUID as a customer id", () => {
    expect(parseUuid(" 3F2504E0-4F89-41D3-9A0C-0305E82C3301 ")).toBe(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    );
    expect(parseUuid("customer@example.com")).toBeNull();
  });
});

describe("marketing texts", () => {
  const t = DICTIONARIES.en;
  const m = MARKETING_DICTIONARIES.en;

  it("localizes feature reasons and wallet failures", () => {
    expect(marketingError(t, m, new StaffApiError(409, "CONFLICT", { reason: "CODE_TAKEN" }))).toBe(
      m.conflicts.CODE_TAKEN,
    );
    expect(
      marketingError(
        t,
        m,
        new StaffApiError(403, "PERMISSION_DENIED", { reason: "SELF_APPROVAL" }),
      ),
    ).toBe(m.conflicts.SELF_APPROVAL);
    expect(
      marketingError(
        t,
        m,
        new StaffApiError(422, "WALLET_INSUFFICIENT_FUNDS", { available: 1250 }),
      ),
    ).toBe("The wallet holds only 12.50 EGP available.");
    expect(marketingError(t, m, new StaffApiError(403, "PERMISSION_DENIED"))).toBe(
      t.errors.PERMISSION_DENIED,
    );
  });

  it("has the same keys in Arabic and English", () => {
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, inner]) =>
        typeof inner === "object" ? keys(inner).map((k) => `${key}.${k}`) : [key],
      );
    expect(keys(MARKETING_DICTIONARIES.ar).sort()).toEqual(keys(MARKETING_DICTIONARIES.en).sort());
  });
});
