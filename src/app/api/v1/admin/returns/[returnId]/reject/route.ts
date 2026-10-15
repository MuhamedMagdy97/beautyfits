import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { rejectReturnSchema } from "@/server/modules/returns/schemas";

/** POST /api/v1/admin/returns/{returnId}/reject — reject with a reason (`APPROVE_RETURN`, Q92). */
export const POST = withApi<RouteContext<"/api/v1/admin/returns/[returnId]/reject">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "APPROVE_RETURN");
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const input = await parseJsonBody(request, rejectReturnSchema);
    const result = await getReturnsService().rejectReturn(employee.employeeId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
