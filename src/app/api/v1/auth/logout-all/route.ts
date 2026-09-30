import { withApi } from "@/server/http/route-handler";
import { getAuthService } from "@/server/modules/auth/auth-service";
import { requireCustomer } from "@/server/modules/auth/guard";
import { noContent, requestMeta } from "@/server/modules/auth/http";

/** POST /api/v1/auth/logout-all — revokes every session of the customer (Q164). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request, { allowPending: true });
  await getAuthService().logoutAll(customer, requestMeta(request, api));
  return noContent(api.requestId, customer.credentialSource === "cookie");
});
