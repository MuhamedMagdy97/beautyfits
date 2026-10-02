import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { productStatusChangeSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/products/{id}/unpublish — take a published or disabled product back to draft
 * (`PRODUCT_PUBLISH`, ADR-0022). Body optional: `{ reason? }`.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/products/[id]/unpublish">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_PUBLISH");
    const id = pathId((await context.params).id, "Product");
    const input = await parseOptionalJsonBody(request, productStatusChangeSchema);
    const product = await getProductsService().changeProductStatus(
      { employeeId: employee.employeeId },
      id,
      "unpublish",
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, product);
  },
);
