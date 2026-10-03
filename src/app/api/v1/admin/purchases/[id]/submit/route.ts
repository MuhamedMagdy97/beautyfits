import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { getPurchaseOrdersService } from "@/server/modules/purchasing/purchase-orders-service";
import { optionalReasonSchema } from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/purchases/{id}/submit — submit a draft for approval (`PURCHASE_CREATE`). Body optional. */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/submit">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PURCHASE_CREATE");
    const id = pathId((await context.params).id, "Purchase order");
    const input = await parseOptionalJsonBody(request, optionalReasonSchema);
    const purchase = await getPurchaseOrdersService().submitPurchase(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, purchase);
  },
);
