import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { presentProduct } from "@/server/modules/catalog/presentation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { createProductSchema, listProductsQuerySchema } from "@/server/modules/catalog/schemas";
import { permissionDenied, requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/products — list and search products (`PRODUCT_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "PRODUCT_VIEW");
  const query = parseQuery(request, listProductsQuerySchema);
  const page = await getProductsService().listProducts(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/**
 * POST /api/v1/admin/products — create a draft product with its default variant (`PRODUCT_CREATE`;
 * a `defaultVariant.sellingPrice` also needs `EDIT_PRODUCT_PRICE`, Q73).
 */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "PRODUCT_CREATE");
  const input = await parseJsonBody(request, createProductSchema);
  if (
    input.defaultVariant.sellingPrice !== undefined &&
    !employee.permissions.has("EDIT_PRODUCT_PRICE")
  ) {
    throw permissionDenied("You do not have permission to set prices.", {
      requiredPermissions: ["EDIT_PRODUCT_PRICE"],
    });
  }
  const product = await getProductsService().createProduct(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, presentProduct(product, employee.permissions), { status: 201 });
});
