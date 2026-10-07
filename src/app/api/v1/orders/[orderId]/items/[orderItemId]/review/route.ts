import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getReviewsService } from "@/server/modules/reviews/reviews-service";
import { createReviewSchema } from "@/server/modules/reviews/schemas";

/**
 * POST /api/v1/orders/{orderId}/items/{orderItemId}/review — a verified-purchase
 * review of the item's product, published immediately (Q11, Q12).
 */
export const POST = withApi<RouteContext<"/api/v1/orders/[orderId]/items/[orderItemId]/review">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const params = await context.params;
    const orderId = pathId(params.orderId, "Order item");
    const orderItemId = pathId(params.orderItemId, "Order item");
    const input = await parseJsonBody(request, createReviewSchema);
    const review = await getReviewsService().createReview(
      customer.customerId,
      orderId,
      orderItemId,
      input,
      { logger: api.logger, correlationId: api.requestId },
    );
    return ok(api.requestId, review, { status: 201 });
  },
);
