import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { settleSupplierReturnSchema } from "@/server/modules/purchasing/schemas";
import { getSupplierReturnsService } from "@/server/modules/purchasing/supplier-returns-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/supplier-returns/{id}/settle — record the refund, credit
 * or other settlement (`SUPPLIER_PAYMENT_MANAGE`, Q107, Q120).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/supplier-returns/[id]/settle">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SUPPLIER_PAYMENT_MANAGE");
    const id = pathId((await context.params).id, "Supplier return");
    const input = await parseJsonBody(request, settleSupplierReturnSchema);
    const result = await getSupplierReturnsService().settleReturn(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
