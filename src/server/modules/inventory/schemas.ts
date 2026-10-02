import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Request schemas of the admin inventory endpoints (TASK-019, API §22, ADR-0024). */

/** A technical guard: one adjustment moves at most this many units. */
export const MAX_ADJUSTMENT_QUANTITY = 1_000_000;

export const listInventoryQuerySchema = z.object({
  ...pageQuery,
  /** Matches a SKU or either product name. */
  search: z.string().trim().min(1).max(100).optional(),
});

export const listLowStockQuerySchema = z.object(pageQuery);

export const listMovementsQuerySchema = z.object(pageQuery);

/**
 * A manual adjustment (Q71, Q72): `MANUAL_ADJUSTMENT` corrects Available by a
 * signed quantity; `DAMAGE` moves a positive quantity from Available to
 * Damaged; `DAMAGE_WRITE_OFF` removes a positive quantity from Damaged.
 */
export const adjustInventorySchema = z
  .object({
    type: z.enum(["MANUAL_ADJUSTMENT", "DAMAGE", "DAMAGE_WRITE_OFF"]),
    quantity: z
      .int()
      .min(-MAX_ADJUSTMENT_QUANTITY)
      .max(MAX_ADJUSTMENT_QUANTITY)
      .refine((value) => value !== 0, { message: "The quantity cannot be zero." }),
    reason: z.string().trim().min(1).max(1000),
  })
  .refine((value) => value.type === "MANUAL_ADJUSTMENT" || value.quantity > 0, {
    message: "DAMAGE and DAMAGE_WRITE_OFF take a positive quantity.",
    path: ["quantity"],
  });
