import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { startUploadSchema } from "@/server/modules/media/schemas";
import {
  CUSTOMER_UPLOAD_PURPOSE,
  getUploadsService,
  type UploadActor,
} from "@/server/modules/media/uploads-service";
import { requireStaff } from "@/server/modules/rbac/authorization";

/**
 * POST /api/v1/files/upload-init — start an upload and get a short-lived
 * upload authorization (API §28). Staff need the permission of the file's
 * purpose (`MANAGE_PRODUCT_MEDIA` for `PRODUCT_MEDIA`); `RETURN_EVIDENCE` is
 * uploaded by a signed-in customer (TASK-037).
 */
export const POST = withApi(async (request, api) => {
  const actor = await uploadActor(request);
  const input = await parseJsonBody(request, startUploadSchema);
  const authorization = await getUploadsService().startUpload(actor, input, api.logger);
  return ok(api.requestId, authorization, { status: 201 });
});

/** The session is checked before the body, so the declared purpose only picks the session kind. */
async function uploadActor(request: Request): Promise<UploadActor> {
  const purpose: unknown = await request
    .clone()
    .json()
    .then((body: { purpose?: unknown } | null) => body?.purpose)
    .catch(() => undefined);
  if (purpose === CUSTOMER_UPLOAD_PURPOSE) {
    return { customerId: (await requireCustomer(request)).customerId };
  }
  const employee = await requireStaff(request);
  return { employeeId: employee.employeeId, permissions: employee.permissions };
}
