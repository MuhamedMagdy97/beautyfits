import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getPurchaseOrdersService } from "@/server/modules/purchasing/purchase-orders-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/purchases/{id}/send — record that an approved order was
 * sent to the supplier (`PURCHASE_CREATE`). Staff send it themselves; the
 * system sends nothing (ADR-0027 §3).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/send">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PURCHASE_CREATE");
    const id = pathId((await context.params).id, "Purchase order");
    const purchase = await getPurchaseOrdersService().sendPurchase(employee, id, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, purchase);
  },
);
