import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { presentVariant } from "@/server/modules/catalog/presentation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/variants/{id}/archive — archive a variant (`PRODUCT_ARCHIVE`). */
export const POST = withApi<RouteContext<"/api/v1/admin/variants/[id]/archive">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_ARCHIVE");
    const id = pathId((await context.params).id, "Variant");
    const variant = await getProductsService().archiveVariant(
      { employeeId: employee.employeeId },
      id,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, presentVariant(variant, employee.permissions));
  },
);
