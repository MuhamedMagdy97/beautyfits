import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getCodService } from "@/server/modules/orders/cod-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/orders/{orderId}/record-phone-confirmation — records a
 * COD confirmation received by phone; the System then moves the order to
 * New (R10, `RECORD_COD_CONFIRMATION`).
 */
export const POST = withApi<
  RouteContext<"/api/v1/admin/orders/[orderId]/record-phone-confirmation">
>(async (request, api, context) => {
  const employee = await requirePermission(request, "RECORD_COD_CONFIRMATION");
  const id = pathId((await context.params).orderId, "Order");
  const order = await getCodService().recordPhoneConfirmation(employee, id, {
    logger: api.logger,
    correlationId: api.requestId,
  });
  return ok(api.requestId, order);
});
