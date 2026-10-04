import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { noContent } from "@/server/modules/auth/http";
import { getAddressesService } from "@/server/modules/customers/addresses-service";
import { updateAddressSchema } from "@/server/modules/customers/schemas";
import { pathId } from "@/server/modules/rbac/http";

type Context = RouteContext<"/api/v1/me/addresses/[addressId]">;

/** PATCH /api/v1/me/addresses/{addressId} — edit an address. */
export const PATCH = withApi<Context>(async (request, api, context) => {
  const customer = await requireCustomer(request);
  const id = pathId((await context.params).addressId, "Address");
  const input = await parseJsonBody(request, updateAddressSchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const address = await getAddressesService().updateAddress(customer.customerId, id, input, locale);
  return ok(api.requestId, address);
});

/** DELETE /api/v1/me/addresses/{addressId} — remove an address (orders keep their snapshot). */
export const DELETE = withApi<Context>(async (request, api, context) => {
  const customer = await requireCustomer(request);
  const id = pathId((await context.params).addressId, "Address");
  await getAddressesService().deleteAddress(customer.customerId, id);
  return noContent(api.requestId, false);
});
