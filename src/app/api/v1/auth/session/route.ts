import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { viewBody } from "@/server/modules/auth/http";

/** GET /api/v1/auth/session — the signed-in customer's account and session. */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request, { allowPending: true });
  return ok(api.requestId, viewBody(customer.view, customer.sessionExpiresAt));
});
