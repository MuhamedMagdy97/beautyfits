import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getPurchaseOrdersService } from "@/server/modules/purchasing/purchase-orders-service";
import { requiredReasonSchema } from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/purchases/{id}/cancel — cancel before receiving (`PURCHASE_CREATE`; `PURCHASE_APPROVE` once approved). */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/cancel">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PURCHASE_CREATE");
    const id = pathId((await context.params).id, "Purchase order");
    const input = await parseJsonBody(request, requiredReasonSchema);
    const purchase = await getPurchaseOrdersService().cancelPurchase(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, purchase);
  },
);
