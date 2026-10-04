import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { updateShippingCompanySchema } from "@/server/modules/shipping/schemas";
import { getShippingService } from "@/server/modules/shipping/shipping-service";

/** PATCH /api/v1/admin/shipping/companies/{id} — edit, deactivate or reactivate (`SHIPPING_MANAGE`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/shipping/companies/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SHIPPING_MANAGE");
    const id = pathId((await context.params).id, "Shipping company");
    const input = await parseJsonBody(request, updateShippingCompanySchema);
    const company = await getShippingService().updateCompany(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, company);
  },
);
