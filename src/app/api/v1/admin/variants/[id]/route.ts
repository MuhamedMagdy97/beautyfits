import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getProductsService } from "@/server/modules/catalog/products-service";
import { updateVariantSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** PATCH /api/v1/admin/variants/{id} — edit variant content, not price or cost (`PRODUCT_EDIT`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/variants/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "PRODUCT_EDIT");
    const id = pathId((await context.params).id, "Variant");
    const input = await parseJsonBody(request, updateVariantSchema);
    const variant = await getProductsService().updateVariant(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, variant);
  },
);
