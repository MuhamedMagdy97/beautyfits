import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { inspectReturnItemSchema } from "@/server/modules/returns/schemas";

/**
 * POST /api/v1/admin/return-items/{returnItemId}/inspection — the outcomes of
 * one returned line (`INSPECT_RETURN`; Q30, Q35, Q95).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/return-items/[returnItemId]/inspection">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "INSPECT_RETURN");
    const id = pathId((await context.params).returnItemId, "Return item").toLowerCase();
    const input = await parseJsonBody(request, inspectReturnItemSchema);
    const result = await getReturnsService().inspectItem(employee.employeeId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
