import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getCampaignsService } from "@/server/modules/marketing/campaigns-service";
import { requiredReasonSchema } from "@/server/modules/marketing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/campaigns/{id}/reject — reject back to Draft with a reason (`MARKETING_APPROVE`, Owner/Admin). */
export const POST = withApi<RouteContext<"/api/v1/admin/campaigns/[id]/reject">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MARKETING_APPROVE");
    const id = pathId((await context.params).id, "Campaign");
    const input = await parseJsonBody(request, requiredReasonSchema);
    const campaign = await getCampaignsService().rejectCampaign(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, campaign);
  },
);
