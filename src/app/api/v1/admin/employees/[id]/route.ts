import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getEmployeeManagementService } from "@/server/modules/rbac/employees-service";
import { actorOf, pathId } from "@/server/modules/rbac/http";
import { updateEmployeeSchema } from "@/server/modules/rbac/schemas";

/**
 * PATCH /api/v1/admin/employees/{id} — edit name, department, level and
 * roles (`EMPLOYEE_MANAGE` within the hierarchy, Q65).
 */
export const PATCH = withApi<RouteContext<"/api/v1/admin/employees/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "EMPLOYEE_MANAGE");
    const id = pathId((await context.params).id, "Employee");
    const input = await parseJsonBody(request, updateEmployeeSchema);
    const updated = await getEmployeeManagementService().updateEmployee(
      actorOf(employee),
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, updated);
  },
);
