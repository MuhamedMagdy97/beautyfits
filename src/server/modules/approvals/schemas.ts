import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Request schemas of the approval request endpoints (TASK-013, API §25). */

const REASON_MAX = 1000;
const ENTITY_TYPE_MAX = 64;
const ENTITY_ID_MAX = 200;

export const approvalTypeSchema = z.enum([
  "PURCHASE_ORDER",
  "PURCHASE_OVER_DELIVERY",
  "MARKETING_CAMPAIGN",
  "CRITICAL_SETTING",
]);

export const approvalStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);

export const listApprovalRequestsQuerySchema = z.object({
  ...pageQuery,
  status: approvalStatusSchema.optional(),
  approvalType: approvalTypeSchema.optional(),
  entityType: z.string().trim().min(1).max(ENTITY_TYPE_MAX).optional(),
  entityId: z.string().trim().min(1).max(ENTITY_ID_MAX).optional(),
});

/** Blank means "no reason". */
const optionalReason = z
  .string()
  .trim()
  .max(REASON_MAX)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

export const approveApprovalRequestSchema = z.object({
  reason: optionalReason,
});

/** A rejection always says why (ADR-0018 default). */
export const rejectApprovalRequestSchema = z.object({
  reason: z.string().trim().min(1, { message: "Give a reason for the rejection." }).max(REASON_MAX),
});
