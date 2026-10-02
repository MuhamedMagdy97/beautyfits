import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getInventoryService } from "@/server/modules/inventory/inventory-service";
import { listInventoryQuerySchema } from "@/server/modules/inventory/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/inventory — every variant's stock, by SKU (`INVENTORY_VIEW`, API §22). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "INVENTORY_VIEW");
  const query = parseQuery(request, listInventoryQuerySchema);
  const page = await getInventoryService().listInventory(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
