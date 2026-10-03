import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import {
  getSupplierReturnsService,
  SUPPLIER_RETURN_READERS,
} from "@/server/modules/purchasing/supplier-returns-service";
import { requireAnyPermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/supplier-returns/{id} — one supplier return (`SUPPLIER_RETURN_MANAGE` or supplier finance). */
export const GET = withApi<RouteContext<"/api/v1/admin/supplier-returns/[id]">>(
  async (request, api, context) => {
    await requireAnyPermission(request, SUPPLIER_RETURN_READERS);
    const id = pathId((await context.params).id, "Supplier return");
    return ok(api.requestId, await getSupplierReturnsService().getReturn(id));
  },
);
