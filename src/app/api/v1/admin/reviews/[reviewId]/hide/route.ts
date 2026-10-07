import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReviewsService } from "@/server/modules/reviews/reviews-service";
import { hideReviewSchema } from "@/server/modules/reviews/schemas";

/** POST /api/v1/admin/reviews/{reviewId}/hide — hide with a reason, history kept (Q174). */
export const POST = withApi<RouteContext<"/api/v1/admin/reviews/[reviewId]/hide">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "REVIEW_MODERATE");
    const id = pathId((await context.params).reviewId, "Review");
    const { reason } = await parseJsonBody(request, hideReviewSchema);
    const review = await getReviewsService().hideReview(employee.employeeId, id, reason, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, review);
  },
);
