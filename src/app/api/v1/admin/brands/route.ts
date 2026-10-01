import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { createBrandSchema, listBrandsQuerySchema } from "@/server/modules/catalog/schemas";
import { getTaxonomyService } from "@/server/modules/catalog/taxonomy-service";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/brands — list and search brands (`PRODUCT_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "PRODUCT_VIEW");
  const query = parseQuery(request, listBrandsQuerySchema);
  const page = await getTaxonomyService().listBrands(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/** POST /api/v1/admin/brands — create a brand (`TAXONOMY_MANAGE`). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "TAXONOMY_MANAGE");
  const input = await parseJsonBody(request, createBrandSchema);
  const brand = await getTaxonomyService().createBrand(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, brand, { status: 201 });
});
