import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/orders/{orderId} — one of the customer's own orders, from its snapshots. */
export const GET = withApi<RouteContext<"/api/v1/orders/[orderId]">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).orderId, "Order");
    const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
    return ok(api.requestId, await getOrdersService().getMyOrder(customer.customerId, id, locale));
  },
);
