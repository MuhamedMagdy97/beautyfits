import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Request schemas of the shipping endpoints (TASK-027, API §16, ADR-0033). */

const status = z.enum(["ACTIVE", "INACTIVE"]);
/** Piastres, 0 or more. */
const amount = z.int().min(0).max(Number.MAX_SAFE_INTEGER).transform(BigInt);
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((v) => v !== undefined);
const atLeastOneMessage = { message: "Provide at least one field to change." };

const companyFields = {
  /** Letters, digits, `_` and `-`; stored uppercase. */
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{2,32}$/, { message: "Use 2–32 letters, digits, - or _." })
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(200),
  contactInfo: z.string().trim().min(1).max(1000).nullable(),
  status,
};

export const createShippingCompanySchema = z.object({
  ...companyFields,
  contactInfo: companyFields.contactInfo.default(null),
  status: status.default("ACTIVE"),
});

export const updateShippingCompanySchema = z
  .object(companyFields)
  .partial()
  .refine(atLeastOne, atLeastOneMessage);

export const listShippingCompaniesQuerySchema = z.object({ status: status.optional() });

const ruleFields = {
  /** The company proposed for these orders; null: staff choose (Q126). */
  shippingCompanyId: z.uuid().nullable(),
  /** Null: everywhere. Implied by `areaId`. */
  governorateId: z.uuid().nullable(),
  areaId: z.uuid().nullable(),
  minOrderTotal: amount.nullable(),
  maxOrderTotal: amount.nullable(),
  shippingFee: amount,
  priority: z.int().min(-1000).max(1000),
  activeFrom: timestamp.nullable(),
  activeTo: timestamp.nullable(),
  status,
};

export const createShippingRuleSchema = z.object({
  ...ruleFields,
  shippingCompanyId: ruleFields.shippingCompanyId.default(null),
  governorateId: ruleFields.governorateId.default(null),
  areaId: ruleFields.areaId.default(null),
  minOrderTotal: ruleFields.minOrderTotal.default(null),
  maxOrderTotal: ruleFields.maxOrderTotal.default(null),
  priority: ruleFields.priority.default(0),
  activeFrom: ruleFields.activeFrom.default(null),
  activeTo: ruleFields.activeTo.default(null),
  status: status.default("ACTIVE"),
});

/** Any field; `null` clears an optional one. */
export const updateShippingRuleSchema = z
  .object(ruleFields)
  .partial()
  .refine(atLeastOne, atLeastOneMessage);

export const listShippingRulesQuerySchema = z.object({
  ...pageQuery,
  status: status.optional(),
  governorateId: z.uuid().optional(),
  shippingCompanyId: z.uuid().optional(),
});

/** `GET /shipping/options`: where the order goes. */
export const shippingOptionsQuerySchema = z.object({ areaId: z.uuid() });

export type CreateShippingCompanyInput = z.output<typeof createShippingCompanySchema>;
export type UpdateShippingCompanyInput = z.output<typeof updateShippingCompanySchema>;
export type ListShippingCompaniesQuery = z.output<typeof listShippingCompaniesQuerySchema>;
export type CreateShippingRuleInput = z.output<typeof createShippingRuleSchema>;
export type UpdateShippingRuleInput = z.output<typeof updateShippingRuleSchema>;
export type ListShippingRulesQuery = z.output<typeof listShippingRulesQuerySchema>;
