import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { listMyReturnsQuerySchema } from "@/server/modules/returns/schemas";

/** GET /api/v1/me/returns — the customer's own returns, newest first. */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const query = parseQuery(request, listMyReturnsQuerySchema);
  const page = await getReturnsService().listMyReturns(customer.customerId, query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
