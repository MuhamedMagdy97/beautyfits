import { getClientIp } from "@/server/http/client-ip";
import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getCartService } from "@/server/modules/cart/cart-service";
import { cartOwner } from "@/server/modules/cart/http";
import { chooseCartDiscountSchema } from "@/server/modules/discounts/schemas";

/** PUT /api/v1/cart/discount — choose the cart's discount: `{ code }` or `{ discountId }` (Q138). */
export const PUT = withApi(async (request, api) => {
  const owner = await cartOwner(request);
  const input = await parseJsonBody(request, chooseCartDiscountSchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const cart = await getCartService().chooseDiscount(owner, input, locale, getClientIp(request));
  return ok(api.requestId, cart);
});

/** DELETE /api/v1/cart/discount — remove the chosen discount. */
export const DELETE = withApi(async (request, api) => {
  const owner = await cartOwner(request);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getCartService().removeDiscount(owner, locale));
});
