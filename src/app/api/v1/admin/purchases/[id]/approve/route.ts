import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { getPurchaseOrdersService } from "@/server/modules/purchasing/purchase-orders-service";
import { optionalReasonSchema } from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/purchases/{id}/approve — approve a pending order (`PURCHASE_APPROVE`). Body optional. */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/approve">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PURCHASE_APPROVE");
    const id = pathId((await context.params).id, "Purchase order");
    const input = await parseOptionalJsonBody(request, optionalReasonSchema);
    const purchase = await getPurchaseOrdersService().approvePurchase(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, purchase);
  },
);
