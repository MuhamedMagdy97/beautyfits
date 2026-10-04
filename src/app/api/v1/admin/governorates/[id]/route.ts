import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getLocationsService } from "@/server/modules/locations/locations-service";
import { updateGovernorateSchema } from "@/server/modules/locations/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** PATCH /api/v1/admin/governorates/{id} — rename, deactivate or reactivate (`SHIPPING_MANAGE`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/governorates/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SHIPPING_MANAGE");
    const id = pathId((await context.params).id, "Governorate");
    const input = await parseJsonBody(request, updateGovernorateSchema);
    const governorate = await getLocationsService().updateGovernorate(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, governorate);
  },
);
