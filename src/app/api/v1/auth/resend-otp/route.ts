import { getEnv } from "@/server/config/env";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { resendOtpSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";
import { getVerificationService } from "@/server/modules/auth/verification-service";

/**
 * POST /api/v1/auth/resend-otp — sends a new code (Q160). Same answer whether
 * or not an eligible account exists.
 */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const input = await parseJsonBody(request, resendOtpSchema);
  const result = await getVerificationService().sendCode(input, requestMeta(request, api));
  return ok(api.requestId, result, { status: 202 });
});
