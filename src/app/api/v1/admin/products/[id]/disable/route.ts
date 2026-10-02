import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { presentProduct } from "@/server/modules/catalog/presentation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { productStatusChangeSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/products/{id}/disable — pause a published product (hidden, still editable)
 * (`PRODUCT_ARCHIVE`, ADR-0022). Body optional: `{ reason? }`.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/products/[id]/disable">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_ARCHIVE");
    const id = pathId((await context.params).id, "Product");
    const input = await parseOptionalJsonBody(request, productStatusChangeSchema);
    const product = await getProductsService().changeProductStatus(
      { employeeId: employee.employeeId },
      id,
      "disable",
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, presentProduct(product, employee.permissions));
  },
);
