import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { createReturnSchema } from "@/server/modules/returns/schemas";

/**
 * POST /api/v1/returns/{returnId}/resubmit — a new, corrected request after
 * a rejection; the rejected return is not changed (Q92).
 */
export const POST = withApi<RouteContext<"/api/v1/returns/[returnId]/resubmit">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const input = await parseJsonBody(request, createReturnSchema);
    const created = await getReturnsService().resubmitReturn(customer.customerId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, created, { status: 201 });
  },
);
