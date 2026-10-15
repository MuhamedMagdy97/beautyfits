import { z } from "zod";
import { pageQuery, uuidParam } from "@/server/modules/rbac/schemas";
import { trackingNumber } from "@/server/modules/shipping/schemas";

/** Customer return requests (TASK-037, ADR-0049; API §17, "TASK-037 Amendments"). */

export const MAX_RETURN_REASON_LENGTH = 2000;
/** Photos one return may hold (technical limit, ADR-0049 §4). */
export const MAX_RETURN_EVIDENCE = 10;
/** Order lines one request may list (an order has far fewer). */
const MAX_RETURN_LINES = 100;

export const RETURN_CLAIM_TYPES = [
  "DAMAGED",
  "WRONG_ITEM",
  "DEFECTIVE",
  "EXPIRED",
  "MISSING_ITEM",
  "OTHER",
] as const;
/** Claims that need at least one photo (Q100). */
export const CLAIMS_NEEDING_EVIDENCE: ReadonlySet<string> = new Set([
  "DAMAGED",
  "WRONG_ITEM",
  // Owner decision 2026-10-15; a missing item cannot be photographed.
  "DEFECTIVE",
  "EXPIRED",
]);

const mediaAssetIds = z
  .array(z.uuid().transform((id) => id.toLowerCase()))
  .max(MAX_RETURN_EVIDENCE)
  .refine((ids) => new Set(ids).size === ids.length, { message: "Each file may be sent once." });

/** `POST /orders/{orderId}/returns` and `POST /returns/{returnId}/resubmit`. */
export const createReturnSchema = z
  .object({
    claimType: z.enum(RETURN_CLAIM_TYPES),
    reason: z.string().trim().min(1).max(MAX_RETURN_REASON_LENGTH),
    items: z
      .array(
        z.object({
          orderItemId: uuidParam.transform((id) => id.toLowerCase()),
          quantity: z.number().int().min(1),
        }),
      )
      .min(1)
      .max(MAX_RETURN_LINES)
      .refine((items) => new Set(items.map((i) => i.orderItemId)).size === items.length, {
        message: "Each order item may be listed once.",
      }),
    evidenceMediaAssetIds: mediaAssetIds.default([]),
  })
  .superRefine((value, ctx) => {
    if (CLAIMS_NEEDING_EVIDENCE.has(value.claimType) && value.evidenceMediaAssetIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceMediaAssetIds"],
        params: { code: "evidence_required" },
        message: "Add at least one photo of the problem.",
      });
    }
  });

/** `POST /returns/{returnId}/evidence`. */
export const addReturnEvidenceSchema = z.object({
  mediaAssetIds: mediaAssetIds.pipe(z.array(z.string()).min(1)),
});

/** `GET /me/returns`. */
export const listMyReturnsQuerySchema = z.object({ ...pageQuery });

export const RETURN_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "PICKUP_SCHEDULED",
  "RECEIVED",
  "INSPECTING",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;

/** `GET /admin/returns`. */
export const listReturnsQuerySchema = z.object({
  ...pageQuery,
  status: z.enum(RETURN_STATUSES).optional(),
  orderId: uuidParam.optional(),
  customerId: uuidParam.optional(),
});

// Staff review and pickup (TASK-038, ADR-0056)

/** `POST /admin/returns/{returnId}/approve`: an optional note for the history. */
export const approveReturnSchema = z.object({
  note: z.string().trim().min(1).max(1000).optional(),
});

/** `POST /admin/returns/{returnId}/reject`: the reason is required and shown to the customer (Q92). */
export const rejectReturnSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

/**
 * `POST /admin/returns/{returnId}/pickup` (Q93): the carrier asked to collect
 * the parcel. `feePayer` defaults to the customer (User Flows §11.3, C2).
 */
export const requestReturnPickupSchema = z.object({
  shippingCompanyId: z.uuid().transform((id) => id.toLowerCase()),
  trackingNumber: trackingNumber.optional(),
  feePayer: z.enum(["CUSTOMER", "BEAUTYFITS"]).default("CUSTOMER"),
  notes: z.string().trim().min(1).max(1000).optional(),
});

// Receiving and inspection (TASK-039, ADR-0060)

/** `POST /admin/returns/{returnId}/receive` and `/start-inspection`: an optional note for the history. */
export const returnStepSchema = z.object({
  notes: z.string().trim().min(1).max(1000).optional(),
});

export const RETURN_INSPECTION_RESULTS = ["RESTOCK", "DAMAGED", "REJECTED"] as const;
export const RETURN_ITEM_CONDITIONS = [
  "SELLABLE",
  "DAMAGED",
  "OPENED_USED",
  "MISSING_PARTS",
  "REJECTED",
] as const;

/**
 * `POST /admin/return-items/{returnItemId}/inspection` (Q30, Q35, Q95): the
 * line's units split across outcomes, each with its condition and notes,
 * plus optional staff photos (`RETURN_INSPECTION` uploads).
 */
export const inspectReturnItemSchema = z.object({
  outcomes: z
    .array(
      z.object({
        result: z.enum(RETURN_INSPECTION_RESULTS),
        condition: z.enum(RETURN_ITEM_CONDITIONS),
        quantity: z.number().int().min(1),
        notes: z.string().trim().min(1).max(2000).optional(),
      }),
    )
    .min(1)
    .max(RETURN_ITEM_CONDITIONS.length * RETURN_INSPECTION_RESULTS.length),
  evidenceMediaAssetIds: mediaAssetIds.default([]),
});

export type ReturnStepInput = z.output<typeof returnStepSchema>;
export type InspectReturnItemInput = z.output<typeof inspectReturnItemSchema>;
export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type ApproveReturnInput = z.output<typeof approveReturnSchema>;
export type RejectReturnInput = z.output<typeof rejectReturnSchema>;
export type RequestReturnPickupInput = z.output<typeof requestReturnPickupSchema>;
export type ListReturnsQuery = z.infer<typeof listReturnsQuerySchema>;
