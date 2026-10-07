import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { assignShippingSchema } from "@/server/modules/shipping/schemas";
import { getShipmentsService } from "@/server/modules/shipping/shipments-service";

/** POST /api/v1/admin/orders/{orderId}/assign-shipping — change the order's carrier before handoff (`ASSIGN_SHIPPING`). */
export const POST = withApi<RouteContext<"/api/v1/admin/orders/[orderId]/assign-shipping">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "ASSIGN_SHIPPING");
    const id = pathId((await context.params).orderId, "Order");
    const input = await parseJsonBody(request, assignShippingSchema);
    const order = await getShipmentsService().assignShipping(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, order);
  },
);
