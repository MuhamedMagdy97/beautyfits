import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";

/** GET /api/v1/admin/returns/{returnId} — return detail (`RETURNS_VIEW`). */
export const GET = withApi<RouteContext<"/api/v1/admin/returns/[returnId]">>(
  async (request, api, context) => {
    await requirePermission(request, "RETURNS_VIEW");
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    return ok(api.requestId, await getReturnsService().getReturn(id));
  },
);
