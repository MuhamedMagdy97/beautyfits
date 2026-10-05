import { z } from "zod";
import { egyptianMobileSchema } from "@/server/modules/auth/schemas";
import { pageQuery, uuidParam } from "@/server/modules/rbac/schemas";

const orderStatusSchema = z.enum([
  "PENDING_CONFIRMATION",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_SHIPMENT",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "EXPIRED",
]);

/** `GET /me/orders`. */
export const listMyOrdersQuerySchema = z.object({ ...pageQuery });

/** `GET /admin/orders` (ADR-0036). */
export const listOrdersQuerySchema = z.object({
  ...pageQuery,
  status: orderStatusSchema.optional(),
  customerId: uuidParam.optional(),
  /** Matches the order number. */
  search: z.string().trim().min(1).max(50).optional(),
  /** The contact phone at order time; needs `VIEW_CUSTOMER_CONTACT`. */
  phone: egyptianMobileSchema.optional(),
});

export type ListMyOrdersQuery = z.infer<typeof listMyOrdersQuerySchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
