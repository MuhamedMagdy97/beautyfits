import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getLocationsService } from "@/server/modules/locations/locations-service";
import { createAreaSchema } from "@/server/modules/locations/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/governorates/{id}/areas — add an area (`SHIPPING_MANAGE`). */
export const POST = withApi<RouteContext<"/api/v1/admin/governorates/[id]/areas">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SHIPPING_MANAGE");
    const id = pathId((await context.params).id, "Governorate");
    const input = await parseJsonBody(request, createAreaSchema);
    const area = await getLocationsService().createArea(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, area, { status: 201 });
  },
);
