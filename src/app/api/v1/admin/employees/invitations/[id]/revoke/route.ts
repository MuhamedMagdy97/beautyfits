import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getEmployeeManagementService } from "@/server/modules/rbac/employees-service";
import { actorOf, pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/employees/invitations/{id}/revoke — revoke a pending invitation. */
export const POST = withApi<RouteContext<"/api/v1/admin/employees/invitations/[id]/revoke">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "EMPLOYEE_MANAGE");
    const id = pathId((await context.params).id, "Invitation");
    const invitation = await getEmployeeManagementService().revokeInvitation(
      actorOf(employee),
      id,
      api.logger,
    );
    return ok(api.requestId, invitation);
  },
);
