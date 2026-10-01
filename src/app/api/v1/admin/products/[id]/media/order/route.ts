import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getProductMediaService } from "@/server/modules/catalog/media-service";
import { reorderProductMediaSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * PUT /api/v1/admin/products/{id}/media/order — the display order of the
 * product's images, listing every current image once (`MANAGE_PRODUCT_MEDIA`).
 */
export const PUT = withApi<RouteContext<"/api/v1/admin/products/[id]/media/order">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MANAGE_PRODUCT_MEDIA");
    const id = pathId((await context.params).id, "Product").toLowerCase();
    const { mediaIds } = await parseJsonBody(request, reorderProductMediaSchema);
    const media = await getProductMediaService().reorderMedia(
      { employeeId: employee.employeeId },
      id,
      mediaIds,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, media);
  },
);
