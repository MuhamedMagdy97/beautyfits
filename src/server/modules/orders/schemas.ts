import { z } from "zod";
import { egyptianMobileSchema } from "@/server/modules/auth/schemas";
import { MAX_LINE_QUANTITY } from "@/server/modules/cart/schemas";
import { addressFields } from "@/server/modules/customers/schemas";
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

/** `POST /orders/{orderId}/confirm-cod`: the token from the WhatsApp link (R10). */
export const confirmCodSchema = z.object({ token: z.string().min(1).max(100) });

/**
 * `POST /orders/{orderId}/modify` (C5, R40): the whole new item list (left
 * out = removed), optionally another address, optionally the wallet credit
 * to use (default: what the order holds, at most the new total).
 */
export const modifyOrderSchema = z
  .object({
    items: z
      .array(z.object({ variantId: z.uuid(), quantity: z.int().min(1).max(MAX_LINE_QUANTITY) }))
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((i) => i.variantId)).size === items.length, {
        message: "Each item may appear once.",
      }),
    addressId: z.uuid().optional(),
    address: z.object(addressFields).omit({ label: true }).optional(),
    walletAmount: z
      .int()
      .min(0)
      .max(1_000_000_000_000)
      .transform((value) => BigInt(value))
      .optional(),
  })
  .refine((value) => value.addressId === undefined || value.address === undefined, {
    message: "Give addressId or address, not both.",
    path: ["address"],
  });

export type ModifyOrderInput = z.infer<typeof modifyOrderSchema>;
