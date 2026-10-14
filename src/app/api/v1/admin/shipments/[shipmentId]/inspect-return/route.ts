import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { inspectReturnSchema } from "@/server/modules/shipping/schemas";
import { getShipmentsService } from "@/server/modules/shipping/shipments-service";

/**
 * POST /api/v1/admin/shipments/{shipmentId}/inspect-return — inspect a returned
 * parcel for shipping damage; the order moves Shipped → Cancelled (Q130).
 * `INSPECT_RETURN` is a provisional choice (TASK-036 open items).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/shipments/[shipmentId]/inspect-return">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "INSPECT_RETURN");
    const id = pathId((await context.params).shipmentId, "Shipment");
    const input = await parseOptionalJsonBody(request, inspectReturnSchema);
    const shipment = await getShipmentsService().inspectReturn(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, shipment);
  },
);
