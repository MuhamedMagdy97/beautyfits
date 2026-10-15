import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { getCampaignsService } from "@/server/modules/marketing/campaigns-service";
import { optionalReasonSchema } from "@/server/modules/marketing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/campaigns/{id}/approve — final approval (`MARKETING_APPROVE`, Owner/Admin). Body optional. */
export const POST = withApi<RouteContext<"/api/v1/admin/campaigns/[id]/approve">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MARKETING_APPROVE");
    const id = pathId((await context.params).id, "Campaign");
    const input = await parseOptionalJsonBody(request, optionalReasonSchema);
    const campaign = await getCampaignsService().approveCampaign(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, campaign);
  },
);
