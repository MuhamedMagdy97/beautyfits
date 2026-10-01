import { getEnv } from "@/server/config/env";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { wantsCookieTransport, assertAllowedOrigin } from "@/server/modules/auth/transport";
import { getEmployeeManagementService } from "@/server/modules/rbac/employees-service";
import { acceptInvitationSchema } from "@/server/modules/rbac/schemas";

/**
 * POST /api/v1/employee-auth/accept-invitation — accept an invitation and
 * choose a password (Q64). Creates the employee account; it does not sign in
 * (the first login confirms the device with an email code, R28).
 */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, wantsCookieTransport(request));
  const input = await parseJsonBody(request, acceptInvitationSchema);
  const result = await getEmployeeManagementService().acceptInvitation(
    input,
    requestMeta(request, api),
  );
  return ok(api.requestId, result, { status: 201 });
});
