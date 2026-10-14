import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { requestShippingCancellationSchema } from "@/server/modules/shipping/schemas";
import { getShipmentsService } from "@/server/modules/shipping/shipments-service";

/**
 * POST /api/v1/admin/orders/{orderId}/request-shipping-cancellation — record a
 * shipping cancellation request on the shipment; the order stays Shipped
 * (`REQUEST_SHIPPING_CANCELLATION`, R3).
 */
export const POST = withApi<
  RouteContext<"/api/v1/admin/orders/[orderId]/request-shipping-cancellation">
>(async (request, api, context) => {
  const employee = await requirePermission(request, "REQUEST_SHIPPING_CANCELLATION");
  const id = pathId((await context.params).orderId, "Order");
  const input = await parseOptionalJsonBody(request, requestShippingCancellationSchema);
  const order = await getShipmentsService().requestShippingCancellation(employee, id, input, {
    logger: api.logger,
    correlationId: api.requestId,
  });
  return ok(api.requestId, order);
});
