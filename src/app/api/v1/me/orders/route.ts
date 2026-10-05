import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { listMyOrdersQuerySchema } from "@/server/modules/orders/schemas";

/** GET /api/v1/me/orders — the customer's own orders, newest first. */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const query = parseQuery(request, listMyOrdersQuerySchema);
  const page = await getOrdersService().listMyOrders(customer.customerId, query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
