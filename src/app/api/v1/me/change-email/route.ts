import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { requestMeta } from "@/server/modules/auth/http";
import { getProfileService } from "@/server/modules/customers/profile-service";
import { changeEmailSchema } from "@/server/modules/customers/schemas";

/** POST /api/v1/me/change-email — current password, then a code to the new email (Q152). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, changeEmailSchema);
  const result = await getProfileService().requestEmailChange(
    customer,
    input,
    requestMeta(request, api),
  );
  return ok(api.requestId, result, { status: 202 });
});
