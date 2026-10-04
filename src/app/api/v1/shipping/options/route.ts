import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getCartService } from "@/server/modules/cart/cart-service";
import { cartOwner } from "@/server/modules/cart/http";
import { shippingOptionsQuerySchema } from "@/server/modules/shipping/schemas";
import { getShippingService } from "@/server/modules/shipping/shipping-service";

/** GET /api/v1/shipping/options?areaId= — the shipping fee for the current cart (R37). */
export const GET = withApi(async (request, api) => {
  const { areaId } = parseQuery(request, shippingOptionsQuerySchema);
  const owner = await cartOwner(request);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const cart = await getCartService().getCart(owner, locale);
  return ok(
    api.requestId,
    await getShippingService().quote(areaId, BigInt(cart.total), api.logger),
  );
});
