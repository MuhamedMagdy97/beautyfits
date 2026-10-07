import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getWishlistService } from "@/server/modules/wishlist/wishlist-service";

/** GET /api/v1/me/wishlist — the customer's wishlist with each item's current status. */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getWishlistService().getWishlist(customer.customerId, locale));
});
