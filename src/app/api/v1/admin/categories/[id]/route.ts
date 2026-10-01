import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { updateCategorySchema } from "@/server/modules/catalog/schemas";
import { getTaxonomyService } from "@/server/modules/catalog/taxonomy-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** PATCH /api/v1/admin/categories/{id} — edit, move, deactivate or reactivate a category (`TAXONOMY_MANAGE`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/categories/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "TAXONOMY_MANAGE");
    const id = pathId((await context.params).id, "Category");
    const input = await parseJsonBody(request, updateCategorySchema);
    const category = await getTaxonomyService().updateCategory(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, category);
  },
);
