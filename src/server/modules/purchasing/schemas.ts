import { z } from "zod";
import { pageQuery, uuidParam } from "@/server/modules/rbac/schemas";

/** Request schemas of the admin purchase order endpoints (TASK-022, API §21, ADR-0027). */

export const PURCHASE_ITEMS_MAX = 200;

const notes = z.string().trim().min(1).max(2000);
const reason = z.string().trim().min(1).max(1000);

const item = z.object({
  variantId: uuidParam,
  quantity: z.int().min(1).max(100_000),
  /**
   * Piastres per unit. With the quantity and line limits a total stays far
   * below 2^53, so it is exact in JSON.
   */
  unitCost: z
    .int()
    .min(1)
    .max(100_000_000)
    .transform((value) => BigInt(value)),
});

const items = z
  .array(item)
  .min(1)
  .max(PURCHASE_ITEMS_MAX)
  .refine((lines) => new Set(lines.map((line) => line.variantId)).size === lines.length, {
    message: "Each variant may appear only once.",
  });

export const purchaseStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
]);

export const createPurchaseSchema = z.object({
  supplierId: uuidParam,
  notes: notes.nullable().optional(),
  items,
});

export const updatePurchaseSchema = z
  .object({
    supplierId: uuidParam.optional(),
    /** `null` clears the notes. */
    notes: notes.nullable().optional(),
    /** Replaces every line. */
    items: items.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

export const optionalReasonSchema = z.object({ reason: reason.optional() });
export const requiredReasonSchema = z.object({ reason });

export const listPurchasesQuerySchema = z.object({
  ...pageQuery,
  status: purchaseStatusSchema.optional(),
  supplierId: uuidParam.optional(),
  /** Matches the purchase number. */
  search: z.string().trim().min(1).max(50).optional(),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;
export type PurchaseItemInput = z.infer<typeof item>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
