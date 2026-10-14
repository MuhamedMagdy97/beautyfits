import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";

/** POST /api/v1/returns/{returnId}/cancel — withdraw a request while `PENDING_APPROVAL`. */
export const POST = withApi<RouteContext<"/api/v1/returns/[returnId]/cancel">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const cancelled = await getReturnsService().cancelReturn(customer.customerId, id, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, cancelled);
  },
);
