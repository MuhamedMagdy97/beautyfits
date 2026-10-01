import { getEnv } from "@/server/config/env";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { getEmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { employeeSignedInResponse } from "@/server/modules/auth/employee-http";
import { employeeVerifyOtpSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin, wantsCookieTransport } from "@/server/modules/auth/transport";

/**
 * POST /api/v1/employee-auth/verify-otp — completes the login with the
 * emailed code and trusts this device for 30 days (R28).
 */
export const POST = withApi(async (request, api) => {
  const useCookies = wantsCookieTransport(request);
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, useCookies);
  const input = await parseJsonBody(request, employeeVerifyOtpSchema);
  const signedIn = await getEmployeeAuthService().verifyLoginCode(input, requestMeta(request, api));
  return employeeSignedInResponse(api.requestId, signedIn, useCookies, new Date());
});
