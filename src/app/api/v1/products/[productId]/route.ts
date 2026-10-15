import { AppError } from "@/server/errors/app-error";
import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getStorefrontCatalogService } from "@/server/modules/catalog/storefront-service";

/** GET /api/v1/products/{productId} — a published product by id or slug (public). */
export const GET = withApi<RouteContext<"/api/v1/products/[productId]">>(
  async (request, api, context) => {
    const idOrSlug = (await context.params).productId;
    if (idOrSlug.length > 120) {
      throw new AppError("NOT_FOUND", "Product not found.");
    }
    const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
    return ok(api.requestId, await getStorefrontCatalogService().getProduct(idOrSlug, locale));
  },
);
