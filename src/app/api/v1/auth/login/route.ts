import { getEnv } from "@/server/config/env";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getAuthService } from "@/server/modules/auth/auth-service";
import { requestMeta, signedInResponse } from "@/server/modules/auth/http";
import { loginSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin, wantsCookieTransport } from "@/server/modules/auth/transport";

/** POST /api/v1/auth/login — email + password (R13). */
export const POST = withApi(async (request, api) => {
  const useCookies = wantsCookieTransport(request);
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, useCookies);
  const input = await parseJsonBody(request, loginSchema);
  const signedIn = await getAuthService().login(input, requestMeta(request, api));
  return signedInResponse(api.requestId, signedIn, useCookies, new Date());
});
