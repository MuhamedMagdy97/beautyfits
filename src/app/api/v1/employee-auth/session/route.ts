import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireEmployee } from "@/server/modules/auth/employee-guard";
import { employeeViewBody } from "@/server/modules/auth/employee-http";

/** GET /api/v1/employee-auth/session — the signed-in employee and session limits. */
export const GET = withApi(async (request, api) => {
  const employee = await requireEmployee(request);
  return ok(api.requestId, employeeViewBody(employee.view, employee.session));
});
