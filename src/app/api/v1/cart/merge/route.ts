import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getCartService } from "@/server/modules/cart/cart-service";
import { guestCartToken } from "@/server/modules/cart/http";

/** POST /api/v1/cart/merge — merge the `X-Guest-Cart-Token` cart into the customer's (R33). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const cart = await getCartService().merge(customer.customerId, guestCartToken(request), locale);
  return ok(api.requestId, cart);
});
