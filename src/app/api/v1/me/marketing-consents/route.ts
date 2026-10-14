import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getMarketingConsentService } from "@/server/modules/customers/marketing-consents";
import { marketingConsentsSchema } from "@/server/modules/customers/schemas";

/** GET /api/v1/me/marketing-consents — current marketing consent per channel (Q59). */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  return ok(api.requestId, await getMarketingConsentService().getConsents(customer.customerId));
});

/** PATCH /api/v1/me/marketing-consents — opt in or out of email / WhatsApp marketing (Q59, Q60). */
export const PATCH = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, marketingConsentsSchema);
  return ok(
    api.requestId,
    await getMarketingConsentService().updateConsents(customer.customerId, input),
  );
});
