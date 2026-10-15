import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getCampaignsService } from "@/server/modules/marketing/campaigns-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/campaigns/{id}/send — start sending an approved campaign
 * (`MARKETING_SEND`): fixes its recipients; TASK-049 delivers them.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/campaigns/[id]/send">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MARKETING_SEND");
    const id = pathId((await context.params).id, "Campaign");
    const campaign = await getCampaignsService().sendCampaign(employee, id, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, campaign);
  },
);
