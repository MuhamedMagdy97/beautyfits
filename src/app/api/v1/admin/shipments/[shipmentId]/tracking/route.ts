import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { updateTrackingSchema } from "@/server/modules/shipping/schemas";
import { getShipmentsService } from "@/server/modules/shipping/shipments-service";

/** POST /api/v1/admin/shipments/{shipmentId}/tracking — add or correct the tracking number (`MANAGE_SHIPMENT`). */
export const POST = withApi<RouteContext<"/api/v1/admin/shipments/[shipmentId]/tracking">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MANAGE_SHIPMENT");
    const id = pathId((await context.params).shipmentId, "Shipment");
    const input = await parseJsonBody(request, updateTrackingSchema);
    const shipment = await getShipmentsService().updateTracking(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, shipment);
  },
);
