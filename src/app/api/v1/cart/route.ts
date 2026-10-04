import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getCartService } from "@/server/modules/cart/cart-service";
import { cartOwner } from "@/server/modules/cart/http";

/** GET /api/v1/cart — the current cart with current prices and stock (informational). */
export const GET = withApi(async (request, api) => {
  const owner = await cartOwner(request);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getCartService().getCart(owner, locale));
});
