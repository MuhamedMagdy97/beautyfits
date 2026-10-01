import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { completeUploadSchema } from "@/server/modules/media/schemas";
import { getUploadsService } from "@/server/modules/media/uploads-service";
import { requireStaff } from "@/server/modules/rbac/authorization";

/**
 * POST /api/v1/files/complete — check the uploaded file (type from its
 * content, size, dimensions, security scan) and return the `mediaAsset`
 * (API §28). Only the employee who started the upload can complete it.
 */
export const POST = withApi(async (request, api) => {
  const employee = await requireStaff(request);
  const { mediaAssetId } = await parseJsonBody(request, completeUploadSchema);
  const asset = await getUploadsService().completeUpload(
    { employeeId: employee.employeeId, permissions: employee.permissions },
    mediaAssetId.toLowerCase(),
    api.logger,
  );
  return ok(api.requestId, asset);
});
