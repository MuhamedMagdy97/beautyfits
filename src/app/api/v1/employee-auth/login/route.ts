import { getEnv } from "@/server/config/env";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { getEmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { employeeSignedInResponse, loginTicketResponse } from "@/server/modules/auth/employee-http";
import { employeeLoginSchema } from "@/server/modules/auth/schemas";
import {
  assertAllowedOrigin,
  getEmployeeDeviceCookie,
  wantsCookieTransport,
} from "@/server/modules/auth/transport";

/**
 * POST /api/v1/employee-auth/login — email + password. On a trusted device
 * (R28) the employee is signed in (200); otherwise a code is emailed and a
 * login ticket returned (202).
 */
export const POST = withApi(async (request, api) => {
  const useCookies = wantsCookieTransport(request);
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, useCookies);
  const input = await parseJsonBody(request, employeeLoginSchema);
  const result = await getEmployeeAuthService().login(
    { ...input, deviceToken: input.deviceToken ?? getEmployeeDeviceCookie(request) },
    requestMeta(request, api),
  );
  if (result.otpRequired) {
    return loginTicketResponse(api.requestId, result);
  }
  return employeeSignedInResponse(api.requestId, result.signedIn, useCookies, new Date());
});
