import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { pathId } from "@/server/modules/rbac/http";
import { getReviewsService } from "@/server/modules/reviews/reviews-service";
import { listProductReviewsQuerySchema } from "@/server/modules/reviews/schemas";

/** GET /api/v1/products/{productId}/reviews — published reviews of a published product (public). */
export const GET = withApi<RouteContext<"/api/v1/products/[productId]/reviews">>(
  async (request, api, context) => {
    const id = pathId((await context.params).productId, "Product");
    const query = parseQuery(request, listProductReviewsQuerySchema);
    const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
    const result = await getReviewsService().listProductReviews(id, query, locale);
    return ok(
      api.requestId,
      { summary: result.summary, items: result.items },
      { pagination: result.pagination },
    );
  },
);
