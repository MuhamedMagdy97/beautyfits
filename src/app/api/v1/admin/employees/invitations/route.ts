import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getEmployeeManagementService } from "@/server/modules/rbac/employees-service";
import { listInvitationsQuerySchema } from "@/server/modules/rbac/schemas";

/** GET /api/v1/admin/employees/invitations — invitations, newest first (`EMPLOYEE_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "EMPLOYEE_VIEW");
  const query = parseQuery(request, listInvitationsQuerySchema);
  const page = await getEmployeeManagementService().listInvitations(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
