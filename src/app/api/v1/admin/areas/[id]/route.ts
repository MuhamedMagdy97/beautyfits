import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getLocationsService } from "@/server/modules/locations/locations-service";
import { updateAreaSchema } from "@/server/modules/locations/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** PATCH /api/v1/admin/areas/{id} — rename, deactivate or reactivate an area (`SHIPPING_MANAGE`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/areas/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SHIPPING_MANAGE");
    const id = pathId((await context.params).id, "Area");
    const input = await parseJsonBody(request, updateAreaSchema);
    const area = await getLocationsService().updateArea(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, area);
  },
);
