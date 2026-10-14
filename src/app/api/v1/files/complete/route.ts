import { getDb } from "@/server/db/client";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { completeUploadSchema } from "@/server/modules/media/schemas";
import {
  CUSTOMER_UPLOAD_PURPOSE,
  getUploadsService,
  type UploadActor,
} from "@/server/modules/media/uploads-service";
import { requireStaff } from "@/server/modules/rbac/authorization";

/**
 * POST /api/v1/files/complete — check the uploaded file (type from its
 * content, size, dimensions, security scan) and return the `mediaAsset`
 * (API §28). Only the employee or customer who started the upload can
 * complete it.
 */
export const POST = withApi(async (request, api) => {
  const { mediaAssetId } = await parseJsonBody(request, completeUploadSchema);
  const id = mediaAssetId.toLowerCase();
  // Customer uploads (return evidence) need a customer session; every other file a staff one.
  const asset = await getDb().mediaAsset.findUnique({ where: { id }, select: { purpose: true } });
  let actor: UploadActor;
  if (asset?.purpose === CUSTOMER_UPLOAD_PURPOSE) {
    actor = { customerId: (await requireCustomer(request)).customerId };
  } else {
    const employee = await requireStaff(request);
    actor = { employeeId: employee.employeeId, permissions: employee.permissions };
  }
  const completed = await getUploadsService().completeUpload(actor, id, api.logger);
  return ok(api.requestId, completed);
});
