import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getStorefrontCatalogService } from "@/server/modules/catalog/storefront-service";

/** GET /api/v1/brands — active brands by name (public). */
export const GET = withApi(async (request, api) => {
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getStorefrontCatalogService().listBrands(locale));
});
