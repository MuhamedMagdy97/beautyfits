import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { returnStepSchema } from "@/server/modules/returns/schemas";

/** POST /api/v1/admin/returns/{returnId}/start-inspection — `INSPECT_RETURN` (Q94). */
export const POST = withApi<RouteContext<"/api/v1/admin/returns/[returnId]/start-inspection">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "INSPECT_RETURN");
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const input = await parseOptionalJsonBody(request, returnStepSchema);
    const result = await getReturnsService().startInspection(employee.employeeId, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
