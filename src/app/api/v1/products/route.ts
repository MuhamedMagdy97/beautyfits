import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { publicProductsQuerySchema } from "@/server/modules/catalog/schemas";
import { getStorefrontCatalogService } from "@/server/modules/catalog/storefront-service";

/** GET /api/v1/products — browse and search published products (public). */
export const GET = withApi(async (request, api) => {
  const query = parseQuery(request, publicProductsQuerySchema);
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const page = await getStorefrontCatalogService().listProducts(query, locale);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
