import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getAddressesService } from "@/server/modules/customers/addresses-service";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/me/addresses/{addressId}/set-default — make it the default address. */
export const POST = withApi<RouteContext<"/api/v1/me/addresses/[addressId]/set-default">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).addressId, "Address");
    const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
    const address = await getAddressesService().setDefaultAddress(customer.customerId, id, locale);
    return ok(api.requestId, address);
  },
);
