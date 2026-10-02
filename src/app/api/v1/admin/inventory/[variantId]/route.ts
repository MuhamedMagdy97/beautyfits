import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getInventoryService } from "@/server/modules/inventory/inventory-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/inventory/{variantId} — one variant's stock (`INVENTORY_VIEW`, API §22). */
export const GET = withApi<RouteContext<"/api/v1/admin/inventory/[variantId]">>(
  async (request, api, context) => {
    await requirePermission(request, "INVENTORY_VIEW");
    const id = pathId((await context.params).variantId, "Variant");
    return ok(api.requestId, await getInventoryService().getInventory(id));
  },
);
