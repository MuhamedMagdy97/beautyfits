import { getEnv } from "@/server/config/env";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { getEmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { employeeNoContent } from "@/server/modules/auth/employee-http";
import { employeeResetPasswordSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";

/**
 * POST /api/v1/employee-auth/reset-password — sets a new password with the
 * emailed code and signs out every session on every device (R29).
 */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const input = await parseJsonBody(request, employeeResetPasswordSchema);
  await getEmployeeAuthService().resetPassword(input, requestMeta(request, api));
  return employeeNoContent(api.requestId, false);
});
