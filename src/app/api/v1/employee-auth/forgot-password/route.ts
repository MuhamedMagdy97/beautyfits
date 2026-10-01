import { getEnv } from "@/server/config/env";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { getEmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { employeeForgotPasswordSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";

/**
 * POST /api/v1/employee-auth/forgot-password — emails a password-reset code.
 * Same answer whether or not the email belongs to an active employee.
 */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const input = await parseJsonBody(request, employeeForgotPasswordSchema);
  const result = await getEmployeeAuthService().forgotPassword(input, requestMeta(request, api));
  return ok(api.requestId, result, { status: 202 });
});
