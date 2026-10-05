import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * GET /api/v1/admin/orders/{orderId} — order detail (`ORDERS_VIEW`); contact
 * data with `VIEW_CUSTOMER_CONTACT`, costs with `VIEW_COST_PRICE`.
 */
export const GET = withApi<RouteContext<"/api/v1/admin/orders/[orderId]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "ORDERS_VIEW");
    const id = pathId((await context.params).orderId, "Order");
    return ok(api.requestId, await getOrdersService().getOrder(id, employee.permissions));
  },
);
