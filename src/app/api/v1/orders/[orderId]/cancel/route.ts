import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { cancelMyOrderSchema } from "@/server/modules/orders/schemas";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/orders/{orderId}/cancel — the customer cancels an own order
 * before carrier pickup (R11); stock, discount use and wallet hold are given
 * back. Guests have no online cancellation (R16).
 */
export const POST = withApi<RouteContext<"/api/v1/orders/[orderId]/cancel">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).orderId, "Order");
    const input = await parseOptionalJsonBody(request, cancelMyOrderSchema);
    const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
    const order = await getOrdersService().cancelMyOrder(
      customer.customerId,
      id,
      input.reason ?? null,
      locale,
      { logger: api.logger, correlationId: api.requestId },
    );
    return ok(api.requestId, order);
  },
);
