import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getReviewsService } from "@/server/modules/reviews/reviews-service";
import { reportReviewSchema } from "@/server/modules/reviews/schemas";

/** POST /api/v1/reviews/{reviewId}/report — report a published review, once per customer. */
export const POST = withApi<RouteContext<"/api/v1/reviews/[reviewId]/report">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).reviewId, "Review");
    const { reason } = await parseOptionalJsonBody(request, reportReviewSchema);
    const result = await getReviewsService().reportReview(customer.customerId, id, reason, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
