import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getCartService } from "@/server/modules/cart/cart-service";
import { cartOwner } from "@/server/modules/cart/http";
import { updateCartItemSchema } from "@/server/modules/cart/schemas";
import { pathId } from "@/server/modules/rbac/http";

type Context = RouteContext<"/api/v1/cart/items/[cartItemId]">;

/** PATCH /api/v1/cart/items/{cartItemId} — change quantity and/or variant. */
export const PATCH = withApi<Context>(async (request, api, context) => {
  const owner = await cartOwner(request);
  const id = pathId((await context.params).cartItemId, "Cart item");
  const input = await parseJsonBody(request, updateCartItemSchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getCartService().updateItem(owner, id, input, locale));
});

/** DELETE /api/v1/cart/items/{cartItemId} — remove a line; returns the cart. */
export const DELETE = withApi<Context>(async (request, api, context) => {
  const owner = await cartOwner(request);
  const id = pathId((await context.params).cartItemId, "Cart item");
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getCartService().removeItem(owner, id, locale));
});
