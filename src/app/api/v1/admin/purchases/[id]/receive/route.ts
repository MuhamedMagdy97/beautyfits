import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, requireIdempotencyKey } from "@/server/http/validation";
import { getGoodsReceiptsService } from "@/server/modules/purchasing/goods-receipts-service";
import { receivePurchaseSchema } from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/purchases/{id}/receive — record a delivery with its
 * inspection results (`RECEIVE_PURCHASE`, Q114). Requires `Idempotency-Key`.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/receive">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "RECEIVE_PURCHASE");
    const id = pathId((await context.params).id, "Purchase order");
    const key = requireIdempotencyKey(request);
    const input = await parseJsonBody(request, receivePurchaseSchema);
    const result = await getGoodsReceiptsService().receivePurchase(employee, id, input, key, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result, { status: 201 });
  },
);
