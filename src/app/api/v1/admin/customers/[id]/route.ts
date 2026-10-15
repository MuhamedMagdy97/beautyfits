import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getAdminCustomersService } from "@/server/modules/customers/admin-customers-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * GET /api/v1/admin/customers/{id} — customer detail and latest orders
 * (`CUSTOMER_VIEW`); phone, email and addresses with `VIEW_CUSTOMER_CONTACT`.
 */
export const GET = withApi<RouteContext<"/api/v1/admin/customers/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "CUSTOMER_VIEW");
    const id = pathId((await context.params).id, "Customer");
    const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
    return ok(
      api.requestId,
      await getAdminCustomersService().getCustomer(id, employee.permissions, locale),
    );
  },
);
