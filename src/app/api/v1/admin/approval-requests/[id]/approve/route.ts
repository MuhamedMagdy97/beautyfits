import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { getApprovalService } from "@/server/modules/approvals/approvals";
import { approveApprovalRequestSchema } from "@/server/modules/approvals/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/approval-requests/{id}/approve — approve a pending
 * action and apply it (`APPROVAL_RESOLVE`, Owner/Admin only). Body optional.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/approval-requests/[id]/approve">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "APPROVAL_RESOLVE");
    const id = pathId((await context.params).id, "Approval request");
    const input = await parseOptionalJsonBody(request, approveApprovalRequestSchema);
    const result = await getApprovalService().approve(
      employee.employeeId,
      id,
      input,
      api.requestId,
    );
    return ok(api.requestId, result);
  },
);
