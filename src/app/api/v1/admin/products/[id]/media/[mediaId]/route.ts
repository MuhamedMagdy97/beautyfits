import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getProductMediaService } from "@/server/modules/catalog/media-service";
import { updateProductMediaSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

type Context = RouteContext<"/api/v1/admin/products/[id]/media/[mediaId]">;

async function ids(context: Context) {
  const params = await context.params;
  return {
    productId: pathId(params.id, "Product").toLowerCase(),
    mediaId: pathId(params.mediaId, "Product image").toLowerCase(),
  };
}

/**
 * PATCH /api/v1/admin/products/{id}/media/{mediaId} — change an image's
 * variant or alt text, or make it the main image (`MANAGE_PRODUCT_MEDIA`).
 */
export const PATCH = withApi<Context>(async (request, api, context) => {
  const employee = await requirePermission(request, "MANAGE_PRODUCT_MEDIA");
  const { productId, mediaId } = await ids(context);
  const input = await parseJsonBody(request, updateProductMediaSchema);
  const media = await getProductMediaService().updateMedia(
    { employeeId: employee.employeeId },
    productId,
    mediaId,
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, media);
});

/**
 * DELETE /api/v1/admin/products/{id}/media/{mediaId} — remove an image from
 * the product; the record and file are kept for history
 * (`MANAGE_PRODUCT_MEDIA`). Returns the remaining images.
 */
export const DELETE = withApi<Context>(async (request, api, context) => {
  const employee = await requirePermission(request, "MANAGE_PRODUCT_MEDIA");
  const { productId, mediaId } = await ids(context);
  const media = await getProductMediaService().removeMedia(
    { employeeId: employee.employeeId },
    productId,
    mediaId,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, media);
});
