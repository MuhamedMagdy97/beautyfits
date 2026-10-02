import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { presentVariant, presentVariants } from "@/server/modules/catalog/presentation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { createVariantSchema } from "@/server/modules/catalog/schemas";
import { permissionDenied, requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/products/{id}/variants — the product's variants (`PRODUCT_VIEW`). */
export const GET = withApi<RouteContext<"/api/v1/admin/products/[id]/variants">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_VIEW");
    const id = pathId((await context.params).id, "Product");
    const variants = await getProductsService().listVariants(id);
    return ok(api.requestId, presentVariants(variants, employee.permissions));
  },
);

/**
 * POST /api/v1/admin/products/{id}/variants — add a variant (`PRODUCT_CREATE`; a `sellingPrice`
 * also needs `EDIT_PRODUCT_PRICE`, Q73). A published product's new variant needs a price (ADR-0023).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/products/[id]/variants">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_CREATE");
    const id = pathId((await context.params).id, "Product");
    const input = await parseJsonBody(request, createVariantSchema);
    if (input.sellingPrice !== undefined && !employee.permissions.has("EDIT_PRODUCT_PRICE")) {
      throw permissionDenied("You do not have permission to set prices.", {
        requiredPermissions: ["EDIT_PRODUCT_PRICE"],
      });
    }
    const variant = await getProductsService().createVariant(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, presentVariant(variant, employee.permissions), { status: 201 });
  },
);
