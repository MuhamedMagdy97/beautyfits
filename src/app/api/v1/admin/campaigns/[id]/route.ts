import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getCampaignsService } from "@/server/modules/marketing/campaigns-service";
import { updateCampaignSchema } from "@/server/modules/marketing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/campaigns/{id} — one campaign with its approval and history (`MARKETING_VIEW`). */
export const GET = withApi<RouteContext<"/api/v1/admin/campaigns/[id]">>(
  async (request, api, context) => {
    await requirePermission(request, "MARKETING_VIEW");
    const id = pathId((await context.params).id, "Campaign");
    return ok(api.requestId, await getCampaignsService().getCampaign(id));
  },
);

/** PATCH /api/v1/admin/campaigns/{id} — edit a draft (`MARKETING_EDIT`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/campaigns/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MARKETING_EDIT");
    const id = pathId((await context.params).id, "Campaign");
    const input = await parseJsonBody(request, updateCampaignSchema);
    const campaign = await getCampaignsService().updateCampaign(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, campaign);
  },
);
