import { z } from "zod";

/** Request schemas of the cart endpoints (TASK-025, API §14, ADR-0031). */

/**
 * Technical bound against absurd input (ADR-0031 §3); the real limit is the
 * stock available, checked by the service.
 */
export const MAX_LINE_QUANTITY = 999;

const quantity = z.int().min(1).max(MAX_LINE_QUANTITY);

export const addCartItemSchema = z.object({
  variantId: z.uuid(),
  quantity,
});

export const updateCartItemSchema = z
  .object({
    quantity: quantity.optional(),
    /** Another variant of the same product (e.g. a different shade). */
    variantId: z.uuid().optional(),
  })
  .refine((value) => value.quantity !== undefined || value.variantId !== undefined, {
    message: "Provide quantity or variantId.",
  });

export type AddCartItemInput = z.output<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.output<typeof updateCartItemSchema>;
