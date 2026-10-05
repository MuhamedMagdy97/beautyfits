import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/orders/{orderId}/start-preparing — Confirmed → Preparing (`START_PREPARING`). */
export const POST = withApi<RouteContext<"/api/v1/admin/orders/[orderId]/start-preparing">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "START_PREPARING");
    const id = pathId((await context.params).orderId, "Order");
    const order = await getOrdersService().startPreparing(employee, id, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, order);
  },
);
