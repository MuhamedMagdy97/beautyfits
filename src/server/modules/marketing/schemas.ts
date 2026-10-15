import { z } from "zod";
import { segmentDefinitionSchema } from "@/server/modules/customers/segments";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Request schemas of the admin campaign endpoints (TASK-048, API §24, ADR-0061). */

const name = z.string().trim().min(1).max(200);
/** Email only (null for WhatsApp; checked with the channel by the service). */
const subject = z.string().trim().min(1).max(200);
/** Plain text; TASK-049 renders it for the channel. */
const content = z.string().trim().min(1).max(10_000);
const reason = z.string().trim().min(1).max(1000);

export const campaignStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENDING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

/** The channel is the segment's `channel`. */
export const createCampaignSchema = z.object({
  name,
  segment: segmentDefinitionSchema,
  subject: subject.nullable().optional(),
  content,
});

export const updateCampaignSchema = z
  .object({
    name: name.optional(),
    segment: segmentDefinitionSchema.optional(),
    /** `null` clears it. */
    subject: subject.nullable().optional(),
    content: content.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

export const listCampaignsQuerySchema = z.object({
  ...pageQuery,
  status: campaignStatusSchema.optional(),
  channel: z.enum(["EMAIL", "WHATSAPP"]).optional(),
});

export const optionalReasonSchema = z.object({ reason: reason.optional() });
export const requiredReasonSchema = z.object({ reason });

export type CreateCampaignInput = z.output<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.output<typeof updateCampaignSchema>;
export type ListCampaignsQuery = z.output<typeof listCampaignsQuerySchema>;
