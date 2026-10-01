import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getRolesService } from "@/server/modules/rbac/roles-service";
import { createRoleSchema } from "@/server/modules/rbac/schemas";

/** GET /api/v1/admin/roles — role list (`ROLE_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "ROLE_VIEW");
  return ok(api.requestId, await getRolesService().listRoles());
});

/** POST /api/v1/admin/roles — create a custom role (`ROLE_MANAGE`, Owner/Admin only). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "ROLE_MANAGE");
  const input = await parseJsonBody(request, createRoleSchema);
  const role = await getRolesService().createRole(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, role, { status: 201 });
});
