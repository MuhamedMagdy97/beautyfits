import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getProductMediaService } from "@/server/modules/catalog/media-service";
import { addProductMediaSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/products/{id}/media — attach an uploaded image
 * (`mediaAssetId` from `POST /files/complete`) to the product or one of its
 * variants (`MANAGE_PRODUCT_MEDIA`).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/products/[id]/media">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MANAGE_PRODUCT_MEDIA");
    const id = pathId((await context.params).id, "Product").toLowerCase();
    const input = await parseJsonBody(request, addProductMediaSchema);
    const media = await getProductMediaService().addMedia(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, media, { status: 201 });
  },
);
