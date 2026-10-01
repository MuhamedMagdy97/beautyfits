import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getAuthService } from "@/server/modules/auth/auth-service";
import { requireCustomer } from "@/server/modules/auth/guard";
import { noContent, requestMeta } from "@/server/modules/auth/http";
import { changePasswordSchema } from "@/server/modules/auth/schemas";

/** POST /api/v1/auth/change-password — keeps this session, revokes the others (R23). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request, { allowPending: true });
  const input = await parseJsonBody(request, changePasswordSchema);
  await getAuthService().changePassword(customer, input, requestMeta(request, api));
  return noContent(api.requestId, false);
});
