import { getEnv } from "@/server/config/env";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { verifyRecoverySchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";
import { getVerificationService } from "@/server/modules/auth/verification-service";

/** POST /api/v1/auth/verify-recovery-otp — exchanges a reset code for a single-use reset token. */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const input = await parseJsonBody(request, verifyRecoverySchema);
  const grant = await getVerificationService().verifyRecoveryCode(input, requestMeta(request, api));
  return ok(api.requestId, {
    resetToken: grant.resetToken,
    resetTokenExpiresAt: grant.resetTokenExpiresAt.toISOString(),
  });
});
