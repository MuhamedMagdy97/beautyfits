import { requireCustomer } from "@/server/modules/auth/guard";
import { isWellFormedToken } from "@/server/modules/auth/tokens";
import { getAccessCredential } from "@/server/modules/auth/transport";
import type { CartOwner } from "@/server/modules/cart/cart-service";

/** Header carrying the guest cart token (API §5, §14). */
export const GUEST_CART_HEADER = "x-guest-cart-token";

/** The request's guest cart token, or null when absent or malformed. */
export function guestCartToken(request: Request): string | null {
  const token = request.headers.get(GUEST_CART_HEADER);
  return token && isWellFormedToken("cart", token) ? token : null;
}

/**
 * Whose cart a request uses: a signed-in customer's (any credential must be
 * valid: a bad token is `401`, never a silent fall back to the guest cart),
 * otherwise the guest cart named by `X-Guest-Cart-Token`.
 */
export async function cartOwner(request: Request): Promise<CartOwner> {
  if (getAccessCredential(request)) {
    const customer = await requireCustomer(request);
    return { kind: "customer", customerId: customer.customerId };
  }
  return { kind: "guest", token: guestCartToken(request) };
}
