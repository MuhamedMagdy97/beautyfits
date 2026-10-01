import { withApi } from "@/server/http/route-handler";
import { requestMeta } from "@/server/modules/auth/http";
import { getEmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { requireEmployee } from "@/server/modules/auth/employee-guard";
import { employeeNoContent } from "@/server/modules/auth/employee-http";

/** POST /api/v1/employee-auth/logout — revokes the current session (the device stays trusted). */
export const POST = withApi(async (request, api) => {
  const employee = await requireEmployee(request);
  await getEmployeeAuthService().logout(employee, requestMeta(request, api));
  return employeeNoContent(api.requestId, employee.credentialSource === "cookie");
});
