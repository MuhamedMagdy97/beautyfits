import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getAdminCustomersService } from "@/server/modules/customers/admin-customers-service";
import { listCustomersQuerySchema } from "@/server/modules/customers/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/admin/customers — search customers, newest first
 * (`CUSTOMER_VIEW`); the `phone` filter and contact data need
 * `VIEW_CUSTOMER_CONTACT`.
 */
export const GET = withApi(async (request, api) => {
  const employee = await requirePermission(request, "CUSTOMER_VIEW");
  const query = parseQuery(request, listCustomersQuerySchema);
  const page = await getAdminCustomersService().listCustomers(query, employee.permissions);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
