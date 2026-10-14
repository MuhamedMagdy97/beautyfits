import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getReportingService } from "@/server/modules/analytics/reporting-service";
import { productReportQuerySchema } from "@/server/modules/analytics/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/admin/analytics/products — views, adds to cart, units and
 * revenue per product (`ANALYTICS_VIEW`; costs with `VIEW_PROFIT`). TASK-051.
 */
export const GET = withApi(async (request, api) => {
  const employee = await requirePermission(request, "ANALYTICS_VIEW");
  const query = parseQuery(request, productReportQuerySchema);
  const { period, items, pagination } = await getReportingService().products(
    query,
    employee.permissions,
  );
  return ok(api.requestId, { period, items }, { pagination });
});
