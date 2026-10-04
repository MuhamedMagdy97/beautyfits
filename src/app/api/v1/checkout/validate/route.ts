import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { cartOwner } from "@/server/modules/cart/http";
import { getCheckoutService } from "@/server/modules/checkout/checkout-service";
import { checkoutQuoteSchema } from "@/server/modules/checkout/schemas";

/** POST /api/v1/checkout/validate — the authoritative totals the order would have now. */
export const POST = withApi(async (request, api) => {
  const owner = await cartOwner(request);
  const input = await parseJsonBody(request, checkoutQuoteSchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getCheckoutService().quote(owner, input, locale, api.logger));
});
