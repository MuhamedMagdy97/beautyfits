import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getSegmentService, segmentDefinitionSchema } from "@/server/modules/customers/segments";
import { requirePermission } from "@/server/modules/rbac/authorization";

/**
 * POST /api/v1/admin/segments/preview — number of customers in a segment who
 * are opted in to its channel (`MARKETING_VIEW`). Read-only. TASK-047.
 */
export const POST = withApi(async (request, api) => {
  await requirePermission(request, "MARKETING_VIEW");
  const segment = await parseJsonBody(request, segmentDefinitionSchema);
  return ok(api.requestId, await getSegmentService().preview(segment));
});
