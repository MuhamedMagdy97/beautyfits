import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { optionalReasonSchema } from "@/server/modules/purchasing/schemas";
import { getSupplierReturnsService } from "@/server/modules/purchasing/supplier-returns-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/supplier-returns/{id}/submit — submit a draft for Owner
 * review (`SUPPLIER_RETURN_MANAGE`, Q105). Body optional.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/supplier-returns/[id]/submit">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SUPPLIER_RETURN_MANAGE");
    const id = pathId((await context.params).id, "Supplier return");
    const input = await parseOptionalJsonBody(request, optionalReasonSchema);
    const result = await getSupplierReturnsService().submitReturn(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
