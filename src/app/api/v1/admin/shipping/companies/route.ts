import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import {
  createShippingCompanySchema,
  listShippingCompaniesQuerySchema,
} from "@/server/modules/shipping/schemas";
import { getShippingService } from "@/server/modules/shipping/shipping-service";

/** GET /api/v1/admin/shipping/companies — every shipping company (`SHIPPING_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "SHIPPING_VIEW");
  const query = parseQuery(request, listShippingCompaniesQuerySchema);
  return ok(api.requestId, await getShippingService().listCompanies(query));
});

/** POST /api/v1/admin/shipping/companies — add a contracted company (`SHIPPING_MANAGE`). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "SHIPPING_MANAGE");
  const input = await parseJsonBody(request, createShippingCompanySchema);
  const company = await getShippingService().createCompany(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, company, { status: 201 });
});
