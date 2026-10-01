import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/errors/app-error";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { getAuthService } from "@/server/modules/auth/auth-service";
import { requestMeta, signedInResponse } from "@/server/modules/auth/http";
import { refreshSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin, getRefreshCredential } from "@/server/modules/auth/transport";

/**
 * POST /api/v1/auth/refresh — rotates the token pair. The refresh token comes
 * from the body (Bearer clients) or the refresh cookie (website); the new
 * pair is returned the same way.
 */
export const POST = withApi(async (request, api) => {
  const body = await parseOptionalJsonBody(request, refreshSchema);
  const credential = getRefreshCredential(request, body.refreshToken);
  if (!credential) {
    throw new AppError("UNAUTHENTICATED", "Authentication required. Sign in again.");
  }
  const useCookies = credential.source === "cookie";
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, useCookies);
  const signedIn = await getAuthService().refresh(credential.token, requestMeta(request, api));
  return signedInResponse(api.requestId, signedIn, useCookies, new Date());
});
