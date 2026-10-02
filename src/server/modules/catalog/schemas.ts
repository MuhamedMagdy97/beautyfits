import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/**
 * Request schemas of the admin catalog endpoints: products and variants
 * (TASK-014, ADR-0019), brands and categories (TASK-015, ADR-0020); API §13.
 */

export const PRODUCT_NAME_MAX = 200;
export const DESCRIPTION_MAX = 10_000;
export const SLUG_MAX = 120;
export const SKU_MAX = 64;
export const VARIANT_NAME_MAX = 120;
export const MAX_ATTRIBUTES = 20;
export const ATTRIBUTE_KEY_MAX = 50;
export const ATTRIBUTE_VALUE_MAX = 100;
export const TAXONOMY_NAME_MAX = 120;
/** A product is listed in at most this many categories (ADR-0020). */
export const MAX_CATEGORIES_PER_PRODUCT = 10;

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKU_PATTERN = /^[A-Z0-9]+([._-][A-Z0-9]+)*$/;

/**
 * A slug suggestion from the English name: lowercase Latin letters and digits
 * joined by single hyphens. Empty when the name has no Latin letter or digit.
 */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

const productName = z.string().trim().min(1).max(PRODUCT_NAME_MAX);

/** Blank means "no description". */
const description = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX)
  .transform((value) => (value === "" ? null : value))
  .nullable();

const slug = z.string().trim().toLowerCase().max(SLUG_MAX).regex(SLUG_PATTERN, {
  message: "Use lowercase Latin letters, digits and single hyphens (e.g. matte-lipstick).",
});

/** SKUs ignore case: stored and compared uppercase. */
export const skuSchema = z.string().trim().toUpperCase().min(1).max(SKU_MAX).regex(SKU_PATTERN, {
  message: "Use letters, digits, and single '-', '_' or '.' between them.",
});

/** Blank means "no name". */
const variantName = z
  .string()
  .trim()
  .max(VARIANT_NAME_MAX)
  .transform((value) => (value === "" ? null : value))
  .nullable();

const attributes = z
  .record(
    z.string().trim().min(1).max(ATTRIBUTE_KEY_MAX),
    z.string().trim().min(1).max(ATTRIBUTE_VALUE_MAX),
  )
  .refine((value) => Object.keys(value).length <= MAX_ATTRIBUTES, {
    message: `At most ${MAX_ATTRIBUTES} attributes.`,
  })
  .nullable();

/** Variant names come in pairs: both languages or neither (R14). */
function namePairIssue(value: {
  nameAr?: string | null;
  nameEn?: string | null;
}): { path: string[]; message: string } | null {
  const ar = value.nameAr ?? null;
  const en = value.nameEn ?? null;
  if ((ar === null) !== (en === null)) {
    return {
      path: [ar === null ? "nameAr" : "nameEn"],
      message: "Give the variant name in both Arabic and English, or in neither.",
    };
  }
  return null;
}

const variantFields = {
  sku: skuSchema,
  nameAr: variantName.optional(),
  nameEn: variantName.optional(),
  attributes: attributes.optional(),
};

export const createVariantSchema = z.object(variantFields).superRefine((value, ctx) => {
  const issue = namePairIssue(value);
  if (issue) {
    ctx.addIssue({
      code: "custom",
      path: issue.path,
      message: issue.message,
      params: { code: "variant_name_pair" },
    });
  }
});

/** `null` removes the brand. */
const brandId = z.uuid().nullable();

/** The full list of categories the product is listed in; duplicates are ignored. */
const categoryIds = z
  .array(z.uuid())
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))])
  .refine((ids) => ids.length <= MAX_CATEGORIES_PER_PRODUCT, {
    message: `At most ${MAX_CATEGORIES_PER_PRODUCT} categories.`,
  });

export const createProductSchema = z.object({
  nameAr: productName,
  nameEn: productName,
  /** Derived from `nameEn` when omitted. */
  slug: slug.optional(),
  descriptionAr: description.optional(),
  descriptionEn: description.optional(),
  brandId: brandId.optional(),
  categoryIds: categoryIds.optional(),
  /** The product's default variant (C6). */
  defaultVariant: createVariantSchema,
});

function atLeastOne(value: Record<string, unknown>): boolean {
  return Object.values(value).some((v) => v !== undefined);
}

export const updateProductSchema = z
  .object({
    nameAr: productName.optional(),
    nameEn: productName.optional(),
    slug: slug.optional(),
    descriptionAr: description.optional(),
    descriptionEn: description.optional(),
    brandId: brandId.optional(),
    /** Replaces the product's categories; `[]` removes them all. */
    categoryIds: categoryIds.optional(),
  })
  .refine(atLeastOne, { message: "Provide at least one field to change." });

/**
 * Only `true` is accepted for `isDefault`: the default moves to this variant.
 * A product always has a default, so it is never switched off directly.
 */
export const updateVariantSchema = z
  .object({
    sku: skuSchema.optional(),
    nameAr: variantName.optional(),
    nameEn: variantName.optional(),
    attributes: attributes.optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine(atLeastOne, { message: "Provide at least one field to change." });

export const productStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED", "DISABLED"]);

export const listProductsQuerySchema = z.object({
  ...pageQuery,
  status: productStatusSchema.optional(),
  /** Matches either name, the slug or a variant SKU. */
  search: z.string().trim().min(1).max(100).optional(),
  brandId: z.uuid().optional(),
  /** Products listed directly in this category (not its subcategories). */
  categoryId: z.uuid().optional(),
});

// ---------------------------------------------------------------------------
// Brands and categories (TASK-015, ADR-0020)
// ---------------------------------------------------------------------------

const taxonomyName = z.string().trim().min(1).max(TAXONOMY_NAME_MAX);

export const taxonomyStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const createBrandSchema = z.object({
  nameAr: taxonomyName,
  nameEn: taxonomyName,
  /** Derived from `nameEn` when omitted. */
  slug: slug.optional(),
  descriptionAr: description.optional(),
  descriptionEn: description.optional(),
});

export const updateBrandSchema = z
  .object({
    nameAr: taxonomyName.optional(),
    nameEn: taxonomyName.optional(),
    slug: slug.optional(),
    descriptionAr: description.optional(),
    descriptionEn: description.optional(),
    /** `INACTIVE` deactivates the brand, `ACTIVE` brings it back. */
    status: taxonomyStatusSchema.optional(),
  })
  .refine(atLeastOne, { message: "Provide at least one field to change." });

export const listBrandsQuerySchema = z.object({
  ...pageQuery,
  status: taxonomyStatusSchema.optional(),
  /** Matches either name or the slug. */
  search: z.string().trim().min(1).max(100).optional(),
});

export const createCategorySchema = z.object({
  nameAr: taxonomyName,
  nameEn: taxonomyName,
  /** Derived from `nameEn` when omitted; unique among its siblings. */
  slug: slug.optional(),
  /** Omitted or `null`: a top-level category. */
  parentId: z.uuid().nullable().optional(),
});

export const updateCategorySchema = z
  .object({
    nameAr: taxonomyName.optional(),
    nameEn: taxonomyName.optional(),
    slug: slug.optional(),
    /** Moves the category; `null` makes it top-level. */
    parentId: z.uuid().nullable().optional(),
    /** `INACTIVE` deactivates the category, `ACTIVE` brings it back. */
    status: taxonomyStatusSchema.optional(),
  })
  .refine(atLeastOne, { message: "Provide at least one field to change." });

export const listCategoriesQuerySchema = z.object({
  status: taxonomyStatusSchema.optional(),
});

// ---------------------------------------------------------------------------
// Product media (TASK-016, ADR-0021)
// ---------------------------------------------------------------------------

export const ALT_TEXT_MAX = 250;

/** Blank means "no alt text". */
/** Ids are compared as text, so they are normalized to lowercase. */
const lowerUuid = z.uuid().transform((id) => id.toLowerCase());

const altText = z
  .string()
  .trim()
  .max(ALT_TEXT_MAX)
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const addProductMediaSchema = z.object({
  /** A `SAFE` upload (`POST /files/complete`) for product media. */
  mediaAssetId: lowerUuid,
  /** Null or omitted: an image of the whole product. */
  variantId: lowerUuid.nullable().optional(),
  altTextAr: altText.optional(),
  altTextEn: altText.optional(),
  /** `true` makes it the main image; the first image always becomes main. */
  isMain: z.boolean().optional(),
});

/** Only `true` for `isMain`: the main image moves here (a product never switches it off). */
export const updateProductMediaSchema = z
  .object({
    variantId: lowerUuid.nullable().optional(),
    altTextAr: altText.optional(),
    altTextEn: altText.optional(),
    isMain: z.literal(true).optional(),
  })
  .refine(atLeastOne, { message: "Provide at least one field to change." });

/** Every current image of the product, in the new order. */
export const reorderProductMediaSchema = z.object({
  mediaIds: z
    .array(lowerUuid)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Each image may appear only once.",
    }),
});

/** Body of the lifecycle endpoints (TASK-017); blank means "no reason". */
export const productStatusChangeSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
});
