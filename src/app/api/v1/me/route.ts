import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { viewBody } from "@/server/modules/auth/http";
import { getProfileService } from "@/server/modules/customers/profile-service";
import { updateProfileSchema } from "@/server/modules/customers/schemas";

/** GET /api/v1/me — the signed-in customer's profile. */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  return ok(api.requestId, viewBody(customer.view));
});

/** PATCH /api/v1/me — name, language, date of birth. */
export const PATCH = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, updateProfileSchema);
  return ok(api.requestId, viewBody(await getProfileService().updateProfile(customer, input)));
});
