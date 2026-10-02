import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { presentProduct } from "@/server/modules/catalog/presentation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { updateProductSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/products/{id} — product detail with its variants (`PRODUCT_VIEW`). */
export const GET = withApi<RouteContext<"/api/v1/admin/products/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_VIEW");
    const id = pathId((await context.params).id, "Product");
    const product = await getProductsService().getProduct(id);
    return ok(api.requestId, presentProduct(product, employee.permissions));
  },
);

/** PATCH /api/v1/admin/products/{id} — edit product content (`PRODUCT_EDIT`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/products/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_EDIT");
    const id = pathId((await context.params).id, "Product");
    const input = await parseJsonBody(request, updateProductSchema);
    const product = await getProductsService().updateProduct(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, presentProduct(product, employee.permissions));
  },
);
