import { z } from "zod";
import { pageQuery, uuidParam } from "@/server/modules/rbac/schemas";

/** `GET /me/notifications`, `GET /admin/me/notifications` (Q58). */
export const listNotificationsQuerySchema = z.object({
  ...pageQuery,
  /** `true`: unread only. */
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

/** `GET /admin/notifications/deliveries` (`NOTIFICATION_LOG_VIEW`). */
export const listDeliveriesQuerySchema = z.object({
  ...pageQuery,
  status: z.enum(["PENDING", "SENT", "FAILED", "FALLBACK_SENT"]).optional(),
  channel: z.enum(["EMAIL", "WHATSAPP"]).optional(),
  orderId: uuidParam.optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
