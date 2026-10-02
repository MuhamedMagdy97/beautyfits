import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getInventoryService } from "@/server/modules/inventory/inventory-service";
import { listMovementsQuerySchema } from "@/server/modules/inventory/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/inventory/{variantId}/movements — the variant's ledger, newest first (`INVENTORY_VIEW`). */
export const GET = withApi<RouteContext<"/api/v1/admin/inventory/[variantId]/movements">>(
  async (request, api, context) => {
    await requirePermission(request, "INVENTORY_VIEW");
    const id = pathId((await context.params).variantId, "Variant");
    const query = parseQuery(request, listMovementsQuerySchema);
    const page = await getInventoryService().listMovements(id, query);
    return ok(api.requestId, page.items, { pagination: page.pagination });
  },
);
