import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";

/** GET /api/v1/returns/{returnId} — one of the customer's own returns. */
export const GET = withApi<RouteContext<"/api/v1/returns/[returnId]">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    return ok(api.requestId, await getReturnsService().getMyReturn(customer.customerId, id));
  },
);
