import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { createReturnSchema } from "@/server/modules/returns/schemas";

/**
 * POST /api/v1/orders/{orderId}/returns — a return request for items of the
 * customer's delivered order, within the return window (Q17, R21). Starts in
 * `PENDING_APPROVAL` (Q91).
 */
export const POST = withApi<RouteContext<"/api/v1/orders/[orderId]/returns">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const orderId = pathId((await context.params).orderId, "Order").toLowerCase();
    const input = await parseJsonBody(request, createReturnSchema);
    const created = await getReturnsService().createReturn(customer.customerId, orderId, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, created, { status: 201 });
  },
);
