import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { addWishlistItemSchema } from "@/server/modules/wishlist/schemas";
import { getWishlistService } from "@/server/modules/wishlist/wishlist-service";

/** POST /api/v1/me/wishlist/items — add a variant (already there: no change); returns the wishlist. */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, addWishlistItemSchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const wishlist = await getWishlistService().addItem(customer.customerId, input.variantId, locale);
  return ok(api.requestId, wishlist);
});
