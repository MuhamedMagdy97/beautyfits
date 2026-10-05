import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/orders/{orderId}/confirm — New → Confirmed (`CONFIRM_ORDER`). */
export const POST = withApi<RouteContext<"/api/v1/admin/orders/[orderId]/confirm">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "CONFIRM_ORDER");
    const id = pathId((await context.params).orderId, "Order");
    const order = await getOrdersService().confirmOrder(employee, id, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, order);
  },
);
