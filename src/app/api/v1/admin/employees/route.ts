import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getEmployeeManagementService } from "@/server/modules/rbac/employees-service";
import { actorOf } from "@/server/modules/rbac/http";
import { inviteEmployeeSchema, listEmployeesQuerySchema } from "@/server/modules/rbac/schemas";

/** GET /api/v1/admin/employees — employee list (`EMPLOYEE_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "EMPLOYEE_VIEW");
  const query = parseQuery(request, listEmployeesQuerySchema);
  const page = await getEmployeeManagementService().listEmployees(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/**
 * POST /api/v1/admin/employees — invite an employee by work email (Q64;
 * `EMPLOYEE_MANAGE` within the hierarchy, Q65).
 */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "EMPLOYEE_MANAGE");
  const input = await parseJsonBody(request, inviteEmployeeSchema);
  const result = await getEmployeeManagementService().invite(
    actorOf(employee),
    input,
    requestMeta(request, api),
  );
  return ok(api.requestId, result, { status: 201 });
});
