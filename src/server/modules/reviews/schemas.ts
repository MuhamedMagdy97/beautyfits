import { z } from "zod";
import { pageQuery, uuidParam } from "@/server/modules/rbac/schemas";

/** Reviews (TASK-044, ADR-0042): rating 1–5 plus written text (Q171). */

export const MAX_REVIEW_BODY_LENGTH = 2000;

const rating = z.number().int().min(1).max(5);
const body = z.string().trim().min(1).max(MAX_REVIEW_BODY_LENGTH);
/** Blank means none. */
const optionalReason = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((value) => value || undefined);

/** `POST /orders/{orderId}/items/{orderItemId}/review`. */
export const createReviewSchema = z.object({ rating, body });

/** `PATCH /reviews/{reviewId}`: at least one field. */
export const updateReviewSchema = z
  .object({ rating: rating.optional(), body: body.optional() })
  .refine((value) => value.rating !== undefined || value.body !== undefined, {
    message: "Send rating or body.",
  });

/** `POST /reviews/{reviewId}/report`. */
export const reportReviewSchema = z.object({ reason: optionalReason });

/** `POST /admin/reviews/{reviewId}/hide`: the reason is required (Q174). */
export const hideReviewSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

/** `POST /admin/reviews/{reviewId}/restore`. */
export const restoreReviewSchema = z.object({ reason: optionalReason });

/** `GET /products/{productId}/reviews`. */
export const listProductReviewsQuerySchema = z.object({ ...pageQuery });

/** `GET /admin/reviews`. */
export const listReviewsQuerySchema = z.object({
  ...pageQuery,
  status: z.enum(["PUBLISHED", "HIDDEN"]).optional(),
  productId: uuidParam.optional(),
  customerId: uuidParam.optional(),
  /** `true`: only reviews with open reports. */
  reported: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;
