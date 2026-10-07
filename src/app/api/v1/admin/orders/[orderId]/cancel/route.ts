import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { cancelOrderSchema } from "@/server/modules/orders/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/orders/{orderId}/cancel — administrative cancellation
 * before carrier pickup, reason required (`CANCEL_ORDER`, Q86, R11).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/orders/[orderId]/cancel">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "CANCEL_ORDER");
    const id = pathId((await context.params).orderId, "Order");
    const { reason } = await parseJsonBody(request, cancelOrderSchema);
    const order = await getOrdersService().cancelOrder(employee, id, reason, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, order);
  },
);
