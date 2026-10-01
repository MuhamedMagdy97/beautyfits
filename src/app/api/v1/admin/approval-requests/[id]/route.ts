import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getApprovalService } from "@/server/modules/approvals/approvals";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/approval-requests/{id} — approval request detail (`APPROVAL_RESOLVE`). */
export const GET = withApi<RouteContext<"/api/v1/admin/approval-requests/[id]">>(
  async (request, api, context) => {
    await requirePermission(request, "APPROVAL_RESOLVE");
    const id = pathId((await context.params).id, "Approval request");
    return ok(api.requestId, await getApprovalService().getApprovalRequest(id));
  },
);
