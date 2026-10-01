import { describe, expect, it } from "vitest";
import {
  createBrandSchema,
  createCategorySchema,
  createProductSchema,
  listProductsQuerySchema,
  MAX_CATEGORIES_PER_PRODUCT,
  updateBrandSchema,
  updateCategorySchema,
  updateProductSchema,
} from "@/server/modules/catalog/schemas";

/** Brand, category and product-link schemas (TASK-015, ADR-0020). */

const ID_A = "019a0000-0000-7000-8000-00000000000a";
const ID_B = "019a0000-0000-7000-8000-00000000000b";

describe("product brand and categories", () => {
  const product = {
    nameAr: "أحمر شفاه",
    nameEn: "Lipstick",
    defaultVariant: { sku: "LIP-1" },
  };

  it("accepts an optional brand and category list on create", () => {
    expect(createProductSchema.parse(product)).not.toHaveProperty("brandId");
    const parsed = createProductSchema.parse({ ...product, brandId: ID_A, categoryIds: [ID_B] });
    expect(parsed).toMatchObject({ brandId: ID_A, categoryIds: [ID_B] });
  });

  it("drops duplicate categories, ignoring case", () => {
    const parsed = updateProductSchema.parse({ categoryIds: [ID_A, ID_A.toUpperCase(), ID_B] });
    expect(parsed.categoryIds).toEqual([ID_A, ID_B]);
  });

  it("allows removing the brand and every category", () => {
    expect(updateProductSchema.parse({ brandId: null, categoryIds: [] })).toEqual({
      brandId: null,
      categoryIds: [],
    });
  });

  it("limits the number of categories", () => {
    const ids = Array.from(
      { length: MAX_CATEGORIES_PER_PRODUCT + 1 },
      (_, i) => `019a0000-0000-7000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(updateProductSchema.safeParse({ categoryIds: ids }).success).toBe(false);
    expect(
      updateProductSchema.safeParse({ categoryIds: ids.slice(0, MAX_CATEGORIES_PER_PRODUCT) })
        .success,
    ).toBe(true);
  });

  it.each([{ brandId: "nope" }, { categoryIds: ["nope"] }, { categoryIds: ID_A }])(
    "rejects %j",
    (body) => {
      expect(updateProductSchema.safeParse(body).success).toBe(false);
    },
  );

  it("filters the product list by brand and category", () => {
    expect(listProductsQuerySchema.parse({ brandId: ID_A, categoryId: ID_B })).toMatchObject({
      brandId: ID_A,
      categoryId: ID_B,
    });
    expect(listProductsQuerySchema.safeParse({ brandId: "x" }).success).toBe(false);
  });
});

describe("brand schemas", () => {
  it("needs both names; slug and descriptions are optional", () => {
    expect(createBrandSchema.safeParse({ nameEn: "Maybelline" }).success).toBe(false);
    expect(
      createBrandSchema.parse({ nameAr: " ميبيلين ", nameEn: "Maybelline", descriptionEn: " " }),
    ).toEqual({ nameAr: "ميبيلين", nameEn: "Maybelline", descriptionEn: null });
  });

  it("lowercases the slug and rejects other characters", () => {
    expect(createBrandSchema.parse({ nameAr: "س", nameEn: "X", slug: "LOreal" }).slug).toBe(
      "loreal",
    );
    expect(createBrandSchema.safeParse({ nameAr: "س", nameEn: "X", slug: "l'oreal" }).success).toBe(
      false,
    );
  });

  it("edits need a field; status is ACTIVE or INACTIVE", () => {
    expect(updateBrandSchema.safeParse({}).success).toBe(false);
    expect(updateBrandSchema.parse({ status: "INACTIVE" })).toEqual({ status: "INACTIVE" });
    expect(updateBrandSchema.safeParse({ status: "ARCHIVED" }).success).toBe(false);
  });

  it("ignores fields clients cannot set", () => {
    expect(updateBrandSchema.parse({ nameEn: "X", id: ID_A, createdAt: "now" })).toEqual({
      nameEn: "X",
    });
  });
});

describe("category schemas", () => {
  it("is top-level unless a parent is given", () => {
    expect(createCategorySchema.parse({ nameAr: "مكياج", nameEn: "Makeup" })).not.toHaveProperty(
      "parentId",
    );
    expect(
      createCategorySchema.parse({ nameAr: "شفاه", nameEn: "Lips", parentId: ID_A }).parentId,
    ).toBe(ID_A);
    expect(
      createCategorySchema.safeParse({ nameAr: "شفاه", nameEn: "Lips", parentId: "x" }).success,
    ).toBe(false);
  });

  it("moves to the top level with a null parent", () => {
    expect(updateCategorySchema.parse({ parentId: null })).toEqual({ parentId: null });
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
  });
});
