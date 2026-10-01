import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { createVariantSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/products/{id}/variants — the product's variants (`PRODUCT_VIEW`). */
export const GET = withApi<RouteContext<"/api/v1/admin/products/[id]/variants">>(
  async (request, api, context) => {
    await requirePermission(request, "PRODUCT_VIEW");
    const id = pathId((await context.params).id, "Product");
    return ok(api.requestId, await getProductsService().listVariants(id));
  },
);

/** POST /api/v1/admin/products/{id}/variants — add a variant (`PRODUCT_CREATE`). */
export const POST = withApi<RouteContext<"/api/v1/admin/products/[id]/variants">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_CREATE");
    const id = pathId((await context.params).id, "Product");
    const input = await parseJsonBody(request, createVariantSchema);
    const variant = await getProductsService().createVariant(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, variant, { status: 201 });
  },
);
