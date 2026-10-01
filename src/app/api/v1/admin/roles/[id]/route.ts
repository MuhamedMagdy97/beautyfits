import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getRolesService } from "@/server/modules/rbac/roles-service";
import { updateRoleSchema } from "@/server/modules/rbac/schemas";

/** PATCH /api/v1/admin/roles/{id} — edit a custom role (`ROLE_MANAGE`, Owner/Admin only). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/roles/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "ROLE_MANAGE");
    const id = pathId((await context.params).id, "Role");
    const input = await parseJsonBody(request, updateRoleSchema);
    const role = await getRolesService().updateRole(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, role);
  },
);
