import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getInventoryService } from "@/server/modules/inventory/inventory-service";
import { listLowStockQuerySchema } from "@/server/modules/inventory/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/admin/inventory/low-stock — active variants at or below their low-stock threshold,
 * lowest stock first (`INVENTORY_VIEW`, Q21, Q110, ADR-0024).
 */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "INVENTORY_VIEW");
  const query = parseQuery(request, listLowStockQuerySchema);
  const page = await getInventoryService().listLowStock(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
