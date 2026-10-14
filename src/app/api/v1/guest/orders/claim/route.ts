import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { requestMeta } from "@/server/modules/auth/http";
import { getProfileService } from "@/server/modules/customers/profile-service";

/** POST /api/v1/guest/orders/claim — a code to the email of the claimable guest orders (R31). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const result = await getProfileService().requestGuestOrderClaim(
    customer,
    requestMeta(request, api),
  );
  return ok(api.requestId, result, { status: 202 });
});
