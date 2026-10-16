import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getCampaignDeliveryService } from "@/server/modules/marketing/delivery-service";
import { campaignDeliveryQuerySchema } from "@/server/modules/marketing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * GET /api/v1/admin/campaigns/{id}/delivery — delivery and failure stats plus
 * a page of recipients with their attempts (`MARKETING_VIEW`). TASK-049.
 */
export const GET = withApi<RouteContext<"/api/v1/admin/campaigns/[id]/delivery">>(
  async (request, api, context) => {
    await requirePermission(request, "MARKETING_VIEW");
    const id = pathId((await context.params).id, "Campaign");
    const query = parseQuery(request, campaignDeliveryQuerySchema);
    const { view, pagination } = await getCampaignDeliveryService().getDelivery(id, query);
    return ok(api.requestId, view, { pagination });
  },
);
