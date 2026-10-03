import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { getPurchaseOrdersService } from "@/server/modules/purchasing/purchase-orders-service";
import {
  createPurchaseSchema,
  listPurchasesQuerySchema,
} from "@/server/modules/purchasing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/purchases — list purchase orders (`PURCHASE_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "PURCHASE_VIEW");
  const query = parseQuery(request, listPurchasesQuerySchema);
  const page = await getPurchaseOrdersService().listPurchases(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/** POST /api/v1/admin/purchases — create a draft purchase order (`PURCHASE_CREATE`). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "PURCHASE_CREATE");
  const input = await parseJsonBody(request, createPurchaseSchema);
  const purchase = await getPurchaseOrdersService().createPurchase(employee, input, {
    logger: api.logger,
    correlationId: api.requestId,
  });
  return ok(api.requestId, purchase, { status: 201 });
});
