import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { requestReturnPickupSchema } from "@/server/modules/returns/schemas";

/** POST /api/v1/admin/returns/{returnId}/pickup — arrange the carrier pickup (`MANAGE_RETURNS`, Q93). */
export const POST = withApi<RouteContext<"/api/v1/admin/returns/[returnId]/pickup">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MANAGE_RETURNS");
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const input = await parseJsonBody(request, requestReturnPickupSchema);
    const result = await getReturnsService().requestPickup(employee.employeeId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
