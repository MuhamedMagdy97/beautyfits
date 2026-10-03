import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { createSupplierReturnSchema } from "@/server/modules/purchasing/schemas";
import { getSupplierReturnsService } from "@/server/modules/purchasing/supplier-returns-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/purchases/{id}/supplier-return — draft a return of
 * damaged units to the supplier (`SUPPLIER_RETURN_MANAGE`, Q105, Q106).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/supplier-return">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SUPPLIER_RETURN_MANAGE");
    const id = pathId((await context.params).id, "Purchase order");
    const input = await parseJsonBody(request, createSupplierReturnSchema);
    const result = await getSupplierReturnsService().createReturn(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result, { status: 201 });
  },
);
