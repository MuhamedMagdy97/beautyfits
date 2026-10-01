import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { createProductSchema, listProductsQuerySchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/products — list and search products (`PRODUCT_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "PRODUCT_VIEW");
  const query = parseQuery(request, listProductsQuerySchema);
  const page = await getProductsService().listProducts(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/** POST /api/v1/admin/products — create a draft product with its default variant (`PRODUCT_CREATE`). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "PRODUCT_CREATE");
  const input = await parseJsonBody(request, createProductSchema);
  const product = await getProductsService().createProduct(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, product, { status: 201 });
});
