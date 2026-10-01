import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getApprovalService } from "@/server/modules/approvals/approvals";
import { rejectApprovalRequestSchema } from "@/server/modules/approvals/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/approval-requests/{id}/reject — reject a pending action
 * with a reason (`APPROVAL_RESOLVE`, Owner/Admin only).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/approval-requests/[id]/reject">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "APPROVAL_RESOLVE");
    const id = pathId((await context.params).id, "Approval request");
    const input = await parseJsonBody(request, rejectApprovalRequestSchema);
    const result = await getApprovalService().reject(employee.employeeId, id, input, api.requestId);
    return ok(api.requestId, result);
  },
);
