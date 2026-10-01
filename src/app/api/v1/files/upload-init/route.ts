import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { startUploadSchema } from "@/server/modules/media/schemas";
import { getUploadsService } from "@/server/modules/media/uploads-service";
import { requireStaff } from "@/server/modules/rbac/authorization";

/**
 * POST /api/v1/files/upload-init — start an upload and get a short-lived
 * upload authorization (API §28). Needs the permission of the file's purpose
 * (`MANAGE_PRODUCT_MEDIA` for `PRODUCT_MEDIA`).
 */
export const POST = withApi(async (request, api) => {
  const employee = await requireStaff(request);
  const input = await parseJsonBody(request, startUploadSchema);
  const authorization = await getUploadsService().startUpload(
    { employeeId: employee.employeeId, permissions: employee.permissions },
    input,
    api.logger,
  );
  return ok(api.requestId, authorization, { status: 201 });
});
