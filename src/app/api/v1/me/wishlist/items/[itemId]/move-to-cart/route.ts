import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getWishlistService } from "@/server/modules/wishlist/wishlist-service";

type Context = RouteContext<"/api/v1/me/wishlist/items/[itemId]/move-to-cart">;

/** POST /api/v1/me/wishlist/items/{itemId}/move-to-cart — one unit to the cart; the item leaves the wishlist. */
export const POST = withApi<Context>(async (request, api, context) => {
  const customer = await requireCustomer(request);
  const id = pathId((await context.params).itemId, "Wishlist item");
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getWishlistService().moveToCart(customer.customerId, id, locale));
});
