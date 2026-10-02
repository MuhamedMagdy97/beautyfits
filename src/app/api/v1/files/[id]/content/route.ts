import { AppError } from "@/server/errors/app-error";
import { withApi } from "@/server/http/route-handler";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";
import { getDb } from "@/server/db/client";
import { isPublicProductImage } from "@/server/modules/catalog/media-service";
import { canViewPurpose, getUploadsService } from "@/server/modules/media/uploads-service";
import { requireStaff } from "@/server/modules/rbac/authorization";
import { uuidParam } from "@/server/modules/rbac/schemas";

/**
 * GET /api/v1/files/{id}/content — the bytes of a checked (`SAFE`) file.
 * Images of published and archived products are public; every other file needs a staff
 * session allowed to see files of its purpose (`PRODUCT_VIEW` or
 * `MANAGE_PRODUCT_MEDIA` for product images).
 */
export const GET = withApi<RouteContext<"/api/v1/files/[id]/content">>(
  async (request, api, context) => {
    const raw = (await context.params).id;
    const id = uuidParam.safeParse(raw).success ? raw.toLowerCase() : null;
    const service = getUploadsService();

    let asset = id ? await service.findServableAsset(id) : null;
    const isPublic =
      asset !== null &&
      asset.purpose === "PRODUCT_MEDIA" &&
      (await isPublicProductImage(getDb(), asset.id));
    if (!isPublic) {
      // Unknown and private files answer alike to anyone without a session.
      const employee = await requireStaff(request);
      if (asset && !canViewPurpose(employee.permissions, asset.purpose)) {
        asset = null;
      }
    }
    const bytes = asset ? await service.readContent(asset) : null;
    if (!asset || !bytes) {
      if (asset) {
        api.logger.error("stored file missing", { mediaAssetId: asset.id });
      }
      throw new AppError("NOT_FOUND", "File not found.");
    }

    const etag = `"${asset.checksum}"`;
    const headers = new Headers({
      [REQUEST_ID_HEADER]: api.requestId,
      "content-type": asset.mimeType,
      // The file is shown as the checked image type only, never sniffed or
      // run as a document.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": `inline; filename="${asset.id}.${asset.objectKey.split(".").pop()}"`,
      "cache-control": isPublic ? "public, max-age=3600" : "private, max-age=300",
      etag,
    });
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("content-length", String(bytes.length));
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  },
);
