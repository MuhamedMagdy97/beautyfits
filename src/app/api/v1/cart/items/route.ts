import { getClientIp } from "@/server/http/client-ip";
import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getAnalyticsService, trackSafely } from "@/server/modules/analytics/analytics-service";
import { analyticsVisitor } from "@/server/modules/analytics/http";
import { getCartService } from "@/server/modules/cart/cart-service";
import { cartOwner } from "@/server/modules/cart/http";
import { addCartItemSchema } from "@/server/modules/cart/schemas";

/** POST /api/v1/cart/items — add a variant; the first guest write returns `guestCartToken`. */
export const POST = withApi(async (request, api) => {
  const owner = await cartOwner(request);
  const input = await parseJsonBody(request, addCartItemSchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const cart = await getCartService().addItem(owner, input, locale, getClientIp(request));
  await trackSafely(api.logger, () =>
    getAnalyticsService().recordAddToCart(analyticsVisitor(request, owner), input),
  );
  return ok(api.requestId, cart);
});
