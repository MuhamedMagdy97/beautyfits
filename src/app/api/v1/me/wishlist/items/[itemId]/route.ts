import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getWishlistService } from "@/server/modules/wishlist/wishlist-service";

type Context = RouteContext<"/api/v1/me/wishlist/items/[itemId]">;

/** DELETE /api/v1/me/wishlist/items/{itemId} — remove an item; returns the wishlist. */
export const DELETE = withApi<Context>(async (request, api, context) => {
  const customer = await requireCustomer(request);
  const id = pathId((await context.params).itemId, "Wishlist item");
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getWishlistService().removeItem(customer.customerId, id, locale));
});
