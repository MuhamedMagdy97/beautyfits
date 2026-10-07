import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReviewsService } from "@/server/modules/reviews/reviews-service";
import { restoreReviewSchema } from "@/server/modules/reviews/schemas";

/** POST /api/v1/admin/reviews/{reviewId}/restore — publish a hidden review again (`REVIEW_MODERATE`). */
export const POST = withApi<RouteContext<"/api/v1/admin/reviews/[reviewId]/restore">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "REVIEW_MODERATE");
    const id = pathId((await context.params).reviewId, "Review");
    const { reason } = await parseOptionalJsonBody(request, restoreReviewSchema);
    const review = await getReviewsService().restoreReview(employee.employeeId, id, reason, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, review);
  },
);
