import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getReviewsService } from "@/server/modules/reviews/reviews-service";
import { updateReviewSchema } from "@/server/modules/reviews/schemas";

/** PATCH /api/v1/reviews/{reviewId} — the author edits the review, re-checked without approval (Q50). */
export const PATCH = withApi<RouteContext<"/api/v1/reviews/[reviewId]">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).reviewId, "Review");
    const input = await parseJsonBody(request, updateReviewSchema);
    const review = await getReviewsService().updateReview(customer.customerId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, review);
  },
);
