import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireIdempotencyKey } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";

/**
 * POST /api/v1/admin/returns/{returnId}/complete — completes an inspected,
 * assessed return and credits its refund to the customer's wallet in the same
 * transaction (`COMPLETE_RETURN`; Q97, ADR-0068). Requires `Idempotency-Key`.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/returns/[returnId]/complete">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "COMPLETE_RETURN");
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const key = requireIdempotencyKey(request);
    const result = await getReturnsService().completeReturn(employee.employeeId, id, key, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
