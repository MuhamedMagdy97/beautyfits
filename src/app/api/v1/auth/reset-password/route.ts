import { getEnv } from "@/server/config/env";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { noContent, requestMeta } from "@/server/modules/auth/http";
import { resetPasswordSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";
import { getVerificationService } from "@/server/modules/auth/verification-service";

/** POST /api/v1/auth/reset-password — sets the new password and signs out every session (R23). */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const input = await parseJsonBody(request, resetPasswordSchema);
  await getVerificationService().resetPassword(input, requestMeta(request, api));
  return noContent(api.requestId, false);
});
