import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getCartService } from "@/server/modules/cart/cart-service";
import { cartOwner } from "@/server/modules/cart/http";

/** POST /api/v1/cart/reprice — accept the current prices (Q37) and list what changed. */
export const POST = withApi(async (request, api) => {
  const owner = await cartOwner(request);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getCartService().reprice(owner, locale));
});
