import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { approveReturnSchema } from "@/server/modules/returns/schemas";

/** POST /api/v1/admin/returns/{returnId}/approve — approve a waiting request (`APPROVE_RETURN`, Q91). */
export const POST = withApi<RouteContext<"/api/v1/admin/returns/[returnId]/approve">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "APPROVE_RETURN");
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const input = await parseOptionalJsonBody(request, approveReturnSchema);
    const result = await getReturnsService().approveReturn(employee.employeeId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
