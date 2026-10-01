import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { employeeViewBody } from "@/server/modules/auth/employee-http";
import { requireStaff, sortedCodes } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/employee-auth/session — the signed-in employee, session limits
 * and effective permissions (TASK-012), so the dashboard can show what the
 * employee may do. The backend still checks every request.
 */
export const GET = withApi(async (request, api) => {
  const employee = await requireStaff(request);
  return ok(api.requestId, {
    ...employeeViewBody(employee.view, employee.session),
    permissions: sortedCodes(employee.permissions),
  });
});
