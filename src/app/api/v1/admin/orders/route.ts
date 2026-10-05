import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { listOrdersQuerySchema } from "@/server/modules/orders/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/admin/orders — search orders (`ORDERS_VIEW`); the `phone`
 * filter and customer phones need `VIEW_CUSTOMER_CONTACT`.
 */
export const GET = withApi(async (request, api) => {
  const employee = await requirePermission(request, "ORDERS_VIEW");
  const query = parseQuery(request, listOrdersQuerySchema);
  const page = await getOrdersService().listOrders(query, employee.permissions);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
