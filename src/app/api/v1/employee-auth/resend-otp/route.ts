import { getEnv } from "@/server/config/env";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requestMeta } from "@/server/modules/auth/http";
import { getEmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { loginTicketResponse } from "@/server/modules/auth/employee-http";
import { employeeResendOtpSchema } from "@/server/modules/auth/schemas";
import { assertAllowedOrigin } from "@/server/modules/auth/transport";

/** POST /api/v1/employee-auth/resend-otp — emails a new login code (Q160) with a new ticket. */
export const POST = withApi(async (request, api) => {
  assertAllowedOrigin(request, getEnv().AUTH_ALLOWED_ORIGINS, false);
  const input = await parseJsonBody(request, employeeResendOtpSchema);
  const ticket = await getEmployeeAuthService().resendLoginCode(input, requestMeta(request, api));
  return loginTicketResponse(api.requestId, ticket);
});
