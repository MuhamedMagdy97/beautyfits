import { getEnv } from "@/server/config/env";
import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getAuthService } from "@/server/modules/auth/auth-service";
import { requestMeta } from "@/server/modules/auth/http";
import { registerSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";

/** POST /api/v1/auth/register — creates a PENDING_VERIFICATION customer account (TASK-007). */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const input = await parseJsonBody(request, registerSchema);
  const registered = await getAuthService().register(
    {
      ...input,
      preferredLocale:
        input.preferredLocale ?? localeFromAcceptLanguage(request.headers.get("accept-language")),
    },
    requestMeta(request, api),
  );
  return ok(
    api.requestId,
    { ...registered, pendingExpiresAt: registered.pendingExpiresAt.toISOString() },
    { status: 201 },
  );
});
