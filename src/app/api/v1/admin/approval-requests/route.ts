import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getApprovalService } from "@/server/modules/approvals/approvals";
import { listApprovalRequestsQuerySchema } from "@/server/modules/approvals/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/approval-requests — approval requests (`APPROVAL_RESOLVE`, Owner/Admin only). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "APPROVAL_RESOLVE");
  const query = parseQuery(request, listApprovalRequestsQuerySchema);
  const page = await getApprovalService().listApprovalRequests(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
