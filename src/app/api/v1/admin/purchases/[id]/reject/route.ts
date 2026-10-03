import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getPurchaseOrdersService } from "@/server/modules/purchasing/purchase-orders-service";
import { requiredReasonSchema } from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/purchases/{id}/reject — reject a pending order back to Draft (`PURCHASE_APPROVE`). */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/reject">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PURCHASE_APPROVE");
    const id = pathId((await context.params).id, "Purchase order");
    const input = await parseJsonBody(request, requiredReasonSchema);
    const purchase = await getPurchaseOrdersService().rejectPurchase(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, purchase);
  },
);
