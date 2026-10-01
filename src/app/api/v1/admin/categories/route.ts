import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { createCategorySchema, listCategoriesQuerySchema } from "@/server/modules/catalog/schemas";
import { getTaxonomyService } from "@/server/modules/catalog/taxonomy-service";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/categories — the whole category tree, parents first (`PRODUCT_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "PRODUCT_VIEW");
  const query = parseQuery(request, listCategoriesQuerySchema);
  return ok(api.requestId, await getTaxonomyService().listCategories(query));
});

/** POST /api/v1/admin/categories — create a category (`TAXONOMY_MANAGE`). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "TAXONOMY_MANAGE");
  const input = await parseJsonBody(request, createCategorySchema);
  const category = await getTaxonomyService().createCategory(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, category, { status: 201 });
});
