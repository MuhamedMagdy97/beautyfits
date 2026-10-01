import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/errors/app-error";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { getEmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { employeeSignedInResponse } from "@/server/modules/auth/employee-http";
import { refreshSchema } from "@/server/modules/auth/schemas";
import {
  assertAllowedOrigin,
  EMPLOYEE_COOKIES,
  getRefreshCredential,
} from "@/server/modules/auth/transport";

/**
 * POST /api/v1/employee-auth/refresh — rotates the token pair. The refresh
 * token comes from the body or the employee refresh cookie; the new pair is
 * returned the same way.
 */
export const POST = withApi(async (request, api) => {
  const body = await parseOptionalJsonBody(request, refreshSchema);
  const credential = getRefreshCredential(request, body.refreshToken, EMPLOYEE_COOKIES);
  if (!credential) {
    throw new AppError("UNAUTHENTICATED", "Authentication required. Sign in again.");
  }
  const useCookies = credential.source === "cookie";
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, useCookies);
  const signedIn = await getEmployeeAuthService().refresh(
    credential.token,
    requestMeta(request, api),
  );
  return employeeSignedInResponse(api.requestId, signedIn, useCookies, new Date());
});
