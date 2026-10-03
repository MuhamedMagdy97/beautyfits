import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getGoodsReceiptsService } from "@/server/modules/purchasing/goods-receipts-service";
import { recordInvoiceSchema } from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/purchases/{id}/invoice — record the supplier invoice as issued (`SUPPLIER_PAYMENT_MANAGE`, Q117). */
export const POST = withApi<RouteContext<"/api/v1/admin/purchases/[id]/invoice">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SUPPLIER_PAYMENT_MANAGE");
    const id = pathId((await context.params).id, "Purchase order");
    const input = await parseJsonBody(request, recordInvoiceSchema);
    const purchase = await getGoodsReceiptsService().recordInvoice(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, purchase, { status: 201 });
  },
);
