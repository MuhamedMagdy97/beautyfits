import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { markShippedSchema } from "@/server/modules/shipping/schemas";
import { getShipmentsService } from "@/server/modules/shipping/shipments-service";

/** POST /api/v1/admin/orders/{orderId}/mark-shipped — Ready for Shipment → Shipped at carrier handoff (`MARK_AS_SHIPPED`). */
export const POST = withApi<RouteContext<"/api/v1/admin/orders/[orderId]/mark-shipped">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MARK_AS_SHIPPED");
    const id = pathId((await context.params).orderId, "Order");
    const input = await parseOptionalJsonBody(request, markShippedSchema);
    const order = await getShipmentsService().markShipped(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, order);
  },
);
