import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Request schemas of the admin product and variant endpoints (TASK-014, API §13, ADR-0019). */

export const PRODUCT_NAME_MAX = 200;
export const DESCRIPTION_MAX = 10_000;
export const SLUG_MAX = 120;
export const SKU_MAX = 64;
export const VARIANT_NAME_MAX = 120;
export const MAX_ATTRIBUTES = 20;
export const ATTRIBUTE_KEY_MAX = 50;
export const ATTRIBUTE_VALUE_MAX = 100;

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

export const createProductSchema = z.object({
  nameAr: productName,
  nameEn: productName,
  /** Derived from `nameEn` when omitted. */
  slug: slug.optional(),
  descriptionAr: description.optional(),
  descriptionEn: description.optional(),
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
});
