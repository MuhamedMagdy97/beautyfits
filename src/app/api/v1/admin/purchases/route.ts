import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import {
  getPurchaseOrdersService,
  purchaseAccess,
} from "@/server/modules/purchasing/purchase-orders-service";
import {
  createPurchaseSchema,
  listPurchasesQuerySchema,
} from "@/server/modules/purchasing/schemas";
import { requireAnyPermission, requirePermission } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/admin/purchases — list purchase orders (`PURCHASE_VIEW`, or
 * `RECEIVE_PURCHASE` without amounts, so receiving staff find deliveries).
 */
export const GET = withApi(async (request, api) => {
  const employee = await requireAnyPermission(request, ["PURCHASE_VIEW", "RECEIVE_PURCHASE"]);
  const query = parseQuery(request, listPurchasesQuerySchema);
  const page = await getPurchaseOrdersService().listPurchases(
    query,
    purchaseAccess(employee.permissions),
  );
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
