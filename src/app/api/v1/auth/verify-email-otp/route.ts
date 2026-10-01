import { getEnv } from "@/server/config/env";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { verifyEmailSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";
import { getVerificationService } from "@/server/modules/auth/verification-service";

/** POST /api/v1/auth/verify-email-otp — verifies the email; the account becomes ACTIVE (Q42, R30). */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const input = await parseJsonBody(request, verifyEmailSchema);
  const verified = await getVerificationService().verifyEmail(input, requestMeta(request, api));
  return ok(api.requestId, verified);
});
