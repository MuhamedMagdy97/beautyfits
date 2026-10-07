import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getReviewsService } from "@/server/modules/reviews/reviews-service";
import { listReviewsQuerySchema } from "@/server/modules/reviews/schemas";

/** GET /api/v1/admin/reviews — all reviews, hidden and reported included (`REVIEW_MODERATE`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "REVIEW_MODERATE");
  const query = parseQuery(request, listReviewsQuerySchema);
  const page = await getReviewsService().listReviews(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
