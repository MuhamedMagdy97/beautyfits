import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { assessReturnSchema } from "@/server/modules/returns/schemas";

/**
 * POST /api/v1/admin/returns/{returnId}/assessment — the final responsibility
 * after inspection (Q99, C2, C3). `COMPLETE_RETURN` until the owner decides
 * who assesses (ADR-0066).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/returns/[returnId]/assessment">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "COMPLETE_RETURN");
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const input = await parseJsonBody(request, assessReturnSchema);
    const result = await getReturnsService().assessReturn(employee.employeeId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
