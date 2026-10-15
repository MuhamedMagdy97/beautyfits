import { describe, expect, it } from "vitest";
import { segmentDefinitionSchema } from "@/server/modules/customers/segments";

const ID = "019a0000-0000-7000-8000-000000000001";

describe("segment definition schema", () => {
  it("needs a channel and the fields of its type", () => {
    expect(segmentDefinitionSchema.safeParse({ type: "ALL_OPTED_IN" }).success).toBe(false);
    expect(
      segmentDefinitionSchema.safeParse({ type: "ALL_OPTED_IN", channel: "SMS" }).success,
    ).toBe(false);
    expect(
      segmentDefinitionSchema.safeParse({ type: "PRODUCT_BUYERS", channel: "EMAIL" }).success,
    ).toBe(false);
    expect(
      segmentDefinitionSchema.safeParse({
        type: "BRAND_BUYERS",
        channel: "WHATSAPP",
        brandIds: [],
      }).success,
    ).toBe(false);
    expect(
      segmentDefinitionSchema.safeParse({
        type: "CATEGORY_BUYERS",
        channel: "EMAIL",
        categoryIds: [ID],
      }).success,
    ).toBe(true);
    expect(segmentDefinitionSchema.safeParse({ type: "VIP", channel: "EMAIL" }).success).toBe(
      false,
    );
  });

  it("takes whole days and whole piastres only", () => {
    const inactive = (inactiveDays: unknown) =>
      segmentDefinitionSchema.safeParse({ type: "INACTIVE", channel: "EMAIL", inactiveDays })
        .success;
    expect(inactive(90)).toBe(true);
    expect(inactive(0)).toBe(false);
    expect(inactive(1.5)).toBe(false);
    const spend = (minSpent: unknown) =>
      segmentDefinitionSchema.safeParse({ type: "HIGH_SPENDING", channel: "EMAIL", minSpent })
        .success;
    expect(spend(500_000)).toBe(true);
    expect(spend(99.99)).toBe(false);
    expect(spend("5000")).toBe(false);
    expect(spend(0)).toBe(false);
  });
});
