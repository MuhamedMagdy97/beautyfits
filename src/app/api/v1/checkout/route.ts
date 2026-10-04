import { getClientIp } from "@/server/http/client-ip";
import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, requireIdempotencyKey } from "@/server/http/validation";
import { cartOwner } from "@/server/modules/cart/http";
import { getCheckoutService } from "@/server/modules/checkout/checkout-service";
import { checkoutSchema } from "@/server/modules/checkout/schemas";

/**
 * POST /api/v1/checkout — places the COD order from the shopper's cart
 * (Q39, Q40). Requires `Idempotency-Key`; a retry returns the same order.
 */
export const POST = withApi(async (request, api) => {
  const owner = await cartOwner(request);
  const key = requireIdempotencyKey(request);
  const input = await parseJsonBody(request, checkoutSchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const order = await getCheckoutService().placeOrder(
    owner,
    input,
    key,
    locale,
    getClientIp(request),
    { logger: api.logger, correlationId: api.requestId },
  );
  return ok(api.requestId, order, { status: 201 });
});
