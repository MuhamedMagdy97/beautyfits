import { withApi } from "@/server/http/route-handler";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";
import { getUploadsService, UPLOAD_TOKEN_HEADER } from "@/server/modules/media/uploads-service";
import { pathId } from "@/server/modules/rbac/http";

/**
 * PUT /api/v1/files/uploads/{id} — the file's bytes, sent to the `url` with
 * the `headers` returned by `POST /files/upload-init` (local storage, API
 * "TASK-016 Amendments"). Authorized by the single-use upload token, not a
 * session. `204` when stored.
 */
export const PUT = withApi<RouteContext<"/api/v1/files/uploads/[id]">>(
  async (request, api, context) => {
    const id = pathId((await context.params).id, "Upload");
    await getUploadsService().receiveUpload(
      id,
      {
        token: request.headers.get(UPLOAD_TOKEN_HEADER),
        contentType: request.headers.get("content-type"),
        contentLength: request.headers.get("content-length"),
        body: request.body,
      },
      api.logger,
    );
    return new Response(null, {
      status: 204,
      headers: { [REQUEST_ID_HEADER]: api.requestId, "cache-control": "no-store" },
    });
  },
);
