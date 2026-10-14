import { z } from "zod";

/** Request schema of `POST /variants/{variantId}/restock-subscription` (TASK-043, R12). */

export const restockSubscriptionSchema = z.object({
  // User Flows §16.3: email, WhatsApp or both.
  channels: z
    .array(z.enum(["WHATSAPP", "EMAIL"]))
    .min(1)
    .max(2)
    .refine((list) => new Set(list).size === list.length, "Channels must not repeat."),
});
