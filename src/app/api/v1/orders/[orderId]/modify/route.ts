import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getRevisionsService } from "@/server/modules/orders/revisions-service";
import { modifyOrderSchema } from "@/server/modules/orders/schemas";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/orders/{orderId}/modify — prices a change of the customer's
 * own order before Preparing as a revision to confirm (C5, Q32, R40). The
 * order itself changes only on confirmation.
 */
export const POST = withApi<RouteContext<"/api/v1/orders/[orderId]/modify">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).orderId, "Order");
    const input = await parseJsonBody(request, modifyOrderSchema);
    const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
    const revision = await getRevisionsService().modify(customer.customerId, id, input, locale, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, revision, { status: 201 });
  },
);
