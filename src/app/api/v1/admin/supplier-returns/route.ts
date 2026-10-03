import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { listSupplierReturnsQuerySchema } from "@/server/modules/purchasing/schemas";
import {
  getSupplierReturnsService,
  SUPPLIER_RETURN_READERS,
} from "@/server/modules/purchasing/supplier-returns-service";
import { requireAnyPermission } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/admin/supplier-returns — supplier returns, filtered by status,
 * supplier or purchase order (`SUPPLIER_RETURN_MANAGE` or supplier finance).
 */
export const GET = withApi(async (request, api) => {
  await requireAnyPermission(request, SUPPLIER_RETURN_READERS);
  const query = parseQuery(request, listSupplierReturnsQuerySchema);
  const page = await getSupplierReturnsService().listReturns(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
