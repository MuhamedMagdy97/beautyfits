import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getGoodsReceiptsService } from "@/server/modules/purchasing/goods-receipts-service";
import { requiredReasonSchema } from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/purchases/{id}/close — nothing more will be received (`PURCHASE_CREATE`). */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/close">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PURCHASE_CREATE");
    const id = pathId((await context.params).id, "Purchase order");
    const input = await parseJsonBody(request, requiredReasonSchema);
    const purchase = await getGoodsReceiptsService().closePurchase(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, purchase);
  },
);
