import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Request schemas of the discount endpoints (TASK-026, API §23, ADR-0032). */

/** Letters, digits, `_` and `-`; matched ignoring case, stored uppercase. */
const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{3,32}$/, { message: "Use 3–32 letters, digits, - or _." })
  .transform((value) => value.toUpperCase());
const name = z.string().trim().min(1).max(200);
/** Positive piastres. */
const amount = z.int().min(1).max(Number.MAX_SAFE_INTEGER).transform(BigInt);
const limit = z.int().min(1).max(1_000_000);
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const ids = z.array(z.uuid()).max(500);

export const discountStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export const discountScopeSchema = z.enum(["STORE_WIDE", "TARGETED"]);

const fields = {
  /** Null: shown in the cart as an offer, no code needed. */
  code: code.nullable(),
  nameAr: name,
  nameEn: name,
  /** Whole percent (R36: 1–100). */
  value: z.int().min(1).max(100),
  scope: discountScopeSchema,
  productIds: ids,
  categoryIds: ids,
  brandIds: ids,
  maxDiscountAmount: amount.nullable(),
  minimumOrderTotal: amount.nullable(),
  startsAt: timestamp,
  endsAt: timestamp.nullable(),
  usageLimitTotal: limit.nullable(),
  usageLimitPerCustomer: limit.nullable(),
};

export const createDiscountSchema = z.object({
  ...fields,
  code: fields.code.default(null),
  productIds: ids.default([]),
  categoryIds: ids.default([]),
  brandIds: ids.default([]),
  maxDiscountAmount: fields.maxDiscountAmount.default(null),
  minimumOrderTotal: fields.minimumOrderTotal.default(null),
  endsAt: fields.endsAt.default(null),
  usageLimitTotal: fields.usageLimitTotal.default(null),
  usageLimitPerCustomer: fields.usageLimitPerCustomer.default(null),
});

/** Any field; a target list given replaces the current one. */
export const updateDiscountSchema = z
  .object(fields)
  .partial()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

export const listDiscountsQuerySchema = z.object({
  ...pageQuery,
  status: discountStatusSchema.optional(),
  /** Matches the code or either name. */
  search: z.string().trim().min(1).max(100).optional(),
});

/** `PUT /cart/discount`: a code, or the id of an offer listed in the cart. */
export const chooseCartDiscountSchema = z.union([
  z.object({ code }).strict(),
  z.object({ discountId: z.uuid() }).strict(),
]);

export type CreateDiscountInput = z.output<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.output<typeof updateDiscountSchema>;
export type ListDiscountsQuery = z.output<typeof listDiscountsQuerySchema>;
export type ChooseCartDiscountInput = z.output<typeof chooseCartDiscountSchema>;
