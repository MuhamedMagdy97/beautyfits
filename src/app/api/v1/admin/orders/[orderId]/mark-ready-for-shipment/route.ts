import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/orders/{orderId}/mark-ready-for-shipment — Preparing → Ready for Shipment (`MARK_READY_FOR_SHIPMENT`). */
export const POST = withApi<RouteContext<"/api/v1/admin/orders/[orderId]/mark-ready-for-shipment">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MARK_READY_FOR_SHIPMENT");
    const id = pathId((await context.params).orderId, "Order");
    const order = await getOrdersService().markReadyForShipment(employee, id, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, order);
  },
);
