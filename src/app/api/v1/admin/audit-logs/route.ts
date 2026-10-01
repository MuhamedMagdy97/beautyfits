import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getAuditLogService } from "@/server/modules/audit/audit";
import { listAuditLogsQuerySchema } from "@/server/modules/audit/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/audit-logs — search audit logs (`VIEW_AUDIT_LOGS`, Owner/Admin only, Q79). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "VIEW_AUDIT_LOGS");
  const query = parseQuery(request, listAuditLogsQuerySchema);
  const page = await getAuditLogService().listAuditLogs(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
