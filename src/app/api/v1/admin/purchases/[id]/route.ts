import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getPurchaseOrdersService } from "@/server/modules/purchasing/purchase-orders-service";
import { updatePurchaseSchema } from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/purchases/{id} — one purchase order with its lines (`PURCHASE_VIEW`). */
export const GET = withApi<RouteContext<"/api/v1/admin/purchases/[id]">>(
  async (request, api, context) => {
    await requirePermission(request, "PURCHASE_VIEW");
    const id = pathId((await context.params).id, "Purchase order");
    return ok(api.requestId, await getPurchaseOrdersService().getPurchase(id));
  },
);

/** PATCH /api/v1/admin/purchases/{id} — edit a draft (`PURCHASE_CREATE`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/purchases/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PURCHASE_CREATE");
    const id = pathId((await context.params).id, "Purchase order");
    const input = await parseJsonBody(request, updatePurchaseSchema);
    const purchase = await getPurchaseOrdersService().updatePurchase(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, purchase);
  },
);
