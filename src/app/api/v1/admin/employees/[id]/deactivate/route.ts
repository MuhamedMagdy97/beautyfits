import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getEmployeeManagementService } from "@/server/modules/rbac/employees-service";
import { actorOf, pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/employees/{id}/deactivate — remove access without
 * deleting history; revokes sessions and trusted devices (Q64, Q69).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/employees/[id]/deactivate">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "EMPLOYEE_MANAGE");
    const id = pathId((await context.params).id, "Employee");
    const updated = await getEmployeeManagementService().deactivateEmployee(
      actorOf(employee),
      id,
      api.logger,
    );
    return ok(api.requestId, updated);
  },
);
