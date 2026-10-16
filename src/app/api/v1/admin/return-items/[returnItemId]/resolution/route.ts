import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { resolveReturnItemSchema } from "@/server/modules/returns/schemas";

/**
 * POST /api/v1/admin/return-items/{returnItemId}/resolution — the R7 outcome
 * of a line's customer-caused units (`RESOLVE_CUSTOMER_CAUSED_RETURN`).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/return-items/[returnItemId]/resolution">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "RESOLVE_CUSTOMER_CAUSED_RETURN");
    const id = pathId((await context.params).returnItemId, "Return item").toLowerCase();
    const input = await parseJsonBody(request, resolveReturnItemSchema);
    const result = await getReturnsService().resolveItem(employee.employeeId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
