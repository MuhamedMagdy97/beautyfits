import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { requestMeta, viewBody } from "@/server/modules/auth/http";
import { getProfileService } from "@/server/modules/customers/profile-service";
import { verifyChangeSchema } from "@/server/modules/customers/schemas";

/** POST /api/v1/me/change-phone/verify — the code switches the phone (R30). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, verifyChangeSchema);
  const view = await getProfileService().confirmPhoneChange(
    customer,
    input,
    requestMeta(request, api),
  );
  return ok(api.requestId, viewBody(view));
});
