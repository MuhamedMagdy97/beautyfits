import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getRevisionsService } from "@/server/modules/orders/revisions-service";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/orders/{orderId}/revisions/{revisionId}/confirm — the
 * customer confirms the change; the order is updated (C5, R40).
 */
export const POST = withApi<
  RouteContext<"/api/v1/orders/[orderId]/revisions/[revisionId]/confirm">
>(async (request, api, context) => {
  const customer = await requireCustomer(request);
  const params = await context.params;
  const orderId = pathId(params.orderId, "Order");
  const revisionId = pathId(params.revisionId, "Revision");
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  const order = await getRevisionsService().confirm(
    customer.customerId,
    orderId,
    revisionId,
    locale,
    { logger: api.logger, correlationId: api.requestId },
  );
  return ok(api.requestId, order);
});
