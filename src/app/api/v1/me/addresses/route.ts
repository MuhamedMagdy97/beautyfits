import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getAddressesService } from "@/server/modules/customers/addresses-service";
import { createAddressSchema } from "@/server/modules/customers/schemas";

/** GET /api/v1/me/addresses — the customer's addresses, default first. */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getAddressesService().listAddresses(customer.customerId, locale));
});

/** POST /api/v1/me/addresses — save an address (the first one becomes the default). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, createAddressSchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const address = await getAddressesService().createAddress(customer.customerId, input, locale);
  return ok(api.requestId, address, { status: 201 });
});
