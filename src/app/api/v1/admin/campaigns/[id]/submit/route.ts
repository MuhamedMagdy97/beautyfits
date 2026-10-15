import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseOptionalJsonBody } from "@/server/http/validation";
import { getCampaignsService } from "@/server/modules/marketing/campaigns-service";
import { optionalReasonSchema } from "@/server/modules/marketing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/campaigns/{id}/submit — submit a draft for Owner/Admin approval (`MARKETING_CREATE`). Body optional. */
export const POST = withApi<RouteContext<"/api/v1/admin/campaigns/[id]/submit">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "MARKETING_CREATE");
    const id = pathId((await context.params).id, "Campaign");
    const input = await parseOptionalJsonBody(request, optionalReasonSchema);
    const campaign = await getCampaignsService().submitCampaign(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, campaign);
  },
);
