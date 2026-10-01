import { describe, expect, it } from "vitest";
import {
  createProductSchema,
  createVariantSchema,
  listProductsQuerySchema,
  skuSchema,
  slugFromName,
  updateProductSchema,
  updateVariantSchema,
} from "@/server/modules/catalog/schemas";

describe("slugFromName", () => {
  it("lowercases and joins Latin words with single hyphens", () => {
    expect(slugFromName("  Matte Lipstick — Rosé  No.5 ")).toBe("matte-lipstick-rose-no-5");
  });

  it("is empty when the name has no Latin letter or digit", () => {
    expect(slugFromName("أحمر شفاه")).toBe("");
  });

  it("never ends with a hyphen after truncation", () => {
    const slug = slugFromName(`${"a".repeat(119)} b`);
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("skuSchema", () => {
  it("trims and uppercases", () => {
    expect(skuSchema.parse("  lip-01.red_x ")).toBe("LIP-01.RED_X");
  });

  it.each(["", "LIP 01", "-LIP", "LIP--01", "LIP/01", "A".repeat(65)])("rejects %j", (sku) => {
    expect(skuSchema.safeParse(sku).success).toBe(false);
  });
});

describe("createProductSchema", () => {
  const valid = {
    nameAr: "أحمر شفاه",
    nameEn: "Matte Lipstick",
    defaultVariant: { sku: "lip-01" },
  };

  it("accepts a minimal product and normalizes blanks", () => {
    const parsed = createProductSchema.parse({ ...valid, descriptionEn: "  " });
    expect(parsed.descriptionEn).toBeNull();
    expect(parsed.defaultVariant.sku).toBe("LIP-01");
    expect(parsed.slug).toBeUndefined();
  });

  it("lowercases a given slug and rejects a malformed one", () => {
    expect(createProductSchema.parse({ ...valid, slug: "Matte-Lipstick" }).slug).toBe(
      "matte-lipstick",
    );
    expect(createProductSchema.safeParse({ ...valid, slug: "matte lipstick" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, slug: "أحمر" }).success).toBe(false);
  });

  it("requires both product names and a default variant", () => {
    expect(createProductSchema.safeParse({ ...valid, nameAr: " " }).success).toBe(false);
    expect(createProductSchema.safeParse({ nameAr: "a", nameEn: "b" }).success).toBe(false);
  });

  it("ignores client-supplied status, price and default flags", () => {
    const parsed = createProductSchema.parse({
      ...valid,
      status: "PUBLISHED",
      sellingPrice: 1,
      defaultVariant: { sku: "x", isDefault: false, price: 5 },
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("sellingPrice");
    expect(parsed.defaultVariant).toEqual({ sku: "X" });
  });
});

describe("createVariantSchema", () => {
  it("requires variant names in both languages or neither", () => {
    expect(createVariantSchema.safeParse({ sku: "A", nameAr: "أحمر", nameEn: "Red" }).success).toBe(
      true,
    );
    expect(createVariantSchema.safeParse({ sku: "A" }).success).toBe(true);
    const half = createVariantSchema.safeParse({ sku: "A", nameEn: "Red" });
    expect(half.success).toBe(false);
    expect(half.error?.issues[0]).toMatchObject({ path: ["nameAr"] });
  });

  it("limits attributes to string values and 20 keys", () => {
    expect(createVariantSchema.safeParse({ sku: "A", attributes: { shade: "Rose" } }).success).toBe(
      true,
    );
    expect(createVariantSchema.safeParse({ sku: "A", attributes: { size: 50 } }).success).toBe(
      false,
    );
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect(createVariantSchema.safeParse({ sku: "A", attributes: many }).success).toBe(false);
  });
});

describe("update schemas", () => {
  it("require at least one field", () => {
    expect(updateProductSchema.safeParse({}).success).toBe(false);
    expect(updateVariantSchema.safeParse({}).success).toBe(false);
  });

  it("accept only true for isDefault", () => {
    expect(updateVariantSchema.safeParse({ isDefault: true }).success).toBe(true);
    expect(updateVariantSchema.safeParse({ isDefault: false }).success).toBe(false);
  });
});

describe("listProductsQuerySchema", () => {
  it("defaults paging and validates status", () => {
    expect(listProductsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 24 });
    expect(listProductsQuerySchema.safeParse({ status: "SOLD" }).success).toBe(false);
    expect(listProductsQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });
});
