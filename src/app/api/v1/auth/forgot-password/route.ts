import { getEnv } from "@/server/config/env";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { forgotPasswordSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";
import { getVerificationService } from "@/server/modules/auth/verification-service";

/**
 * POST /api/v1/auth/forgot-password — emails a password-reset code (User
 * Flows §3.2). Same answer whether or not the email has an account.
 */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const { email } = await parseJsonBody(request, forgotPasswordSchema);
  const result = await getVerificationService().sendCode(
    { email, purpose: "PASSWORD_RESET" },
    requestMeta(request, api),
  );
  return ok(api.requestId, result, { status: 202 });
});
