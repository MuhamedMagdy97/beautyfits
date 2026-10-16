import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";

/** GET /api/v1/admin/returns/{returnId}/refund — the calculated refund (`RETURNS_VIEW`, TASK-040). */
export const GET = withApi<RouteContext<"/api/v1/admin/returns/[returnId]/refund">>(
  async (request, api, context) => {
    await requirePermission(request, "RETURNS_VIEW");
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    return ok(api.requestId, await getReturnsService().getReturnRefund(id));
  },
);
