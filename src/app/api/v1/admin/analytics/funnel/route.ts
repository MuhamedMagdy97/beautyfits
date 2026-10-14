import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getReportingService } from "@/server/modules/analytics/reporting-service";
import { reportQuerySchema } from "@/server/modules/analytics/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/analytics/funnel — views → cart → checkout → orders (`ANALYTICS_VIEW`). TASK-051. */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "ANALYTICS_VIEW");
  const query = parseQuery(request, reportQuerySchema);
  return ok(api.requestId, await getReportingService().funnel(query));
});
