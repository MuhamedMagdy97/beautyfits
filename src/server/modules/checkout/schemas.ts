import { z } from "zod";
import { egyptianMobileSchema, emailSchema } from "@/server/modules/auth/schemas";
import { AUTH_POLICY } from "@/server/modules/auth/policy";
import { addressFields } from "@/server/modules/customers/schemas";

/** Piastres; far below 2^53. */
const amount = z
  .int()
  .min(0)
  .max(1_000_000_000_000)
  .transform((value) => BigInt(value));

/**
 * `POST /checkout/validate` (API §15, TASK-029). A customer delivers to a
 * saved `addressId` or an inline `address`; a guest gives `contact` and an
 * inline `address`. `walletAmount` (customers only) is the wallet credit to
 * use, the rest is paid on delivery (Q167, Q168).
 */
export const checkoutQuoteSchema = z
  .object({
    contact: z
      .object({
        fullName: z.string().trim().min(1).max(AUTH_POLICY.fullNameMaxLength),
        phone: egyptianMobileSchema,
        /** Optional (R31: guest orders without an email are claimed through support). */
        email: emailSchema.optional(),
      })
      .optional(),
    addressId: z.uuid().optional(),
    address: z.object(addressFields).omit({ label: true }).optional(),
    walletAmount: amount.default(BigInt(0)),
  })
  .refine((value) => (value.addressId === undefined) !== (value.address === undefined), {
    message: "Give either addressId or address.",
    path: ["address"],
  });

/**
 * `POST /checkout`: the quote plus `expectedTotal`, the total the customer
 * confirmed. It is compared, never trusted: a different total is refused.
 */
export const checkoutSchema = checkoutQuoteSchema.and(z.object({ expectedTotal: amount }));

export type CheckoutQuoteInput = z.infer<typeof checkoutQuoteSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
