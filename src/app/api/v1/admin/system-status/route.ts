import { getEnv } from "@/server/config/env";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getSystemStatus, hasMonitoringToken } from "@/server/observability/system-status";
import { requirePermission } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/admin/system-status — operational status and alerts (TASK-065,
 * ADR-0073). Staff with `VIEW_AUDIT_LOGS` (Owner/Admin only), or an external
 * monitor presenting `X-Monitoring-Token`. 200 when `ok`, 503 when
 * `degraded` or `down`, so plain uptime checkers can alert on the status code.
 */
export const GET = withApi(async (request, { requestId, logger }) => {
  if (!hasMonitoringToken(request.headers, getEnv().MONITORING_TOKEN)) {
    await requirePermission(request, "VIEW_AUDIT_LOGS");
  }
  const status = await getSystemStatus({ logger });
  return ok(requestId, status, { status: status.status === "ok" ? 200 : 503 });
});
