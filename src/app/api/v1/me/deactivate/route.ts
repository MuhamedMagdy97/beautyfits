import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { noContent, requestMeta } from "@/server/modules/auth/http";
import { getProfileService } from "@/server/modules/customers/profile-service";
import { deactivateSchema } from "@/server/modules/customers/schemas";

/** POST /api/v1/me/deactivate — deactivate and anonymize the account; cannot be undone (Q154, R34). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, deactivateSchema);
  await getProfileService().deactivate(customer, input, requestMeta(request, api));
  return noContent(api.requestId, customer.credentialSource === "cookie");
});
