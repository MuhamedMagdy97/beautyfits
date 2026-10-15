import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { getCampaignsService } from "@/server/modules/marketing/campaigns-service";
import { createCampaignSchema, listCampaignsQuerySchema } from "@/server/modules/marketing/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/campaigns — campaign list, newest first (`MARKETING_VIEW`). TASK-048. */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "MARKETING_VIEW");
  const query = parseQuery(request, listCampaignsQuerySchema);
  const page = await getCampaignsService().listCampaigns(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/** POST /api/v1/admin/campaigns — create a draft (`MARKETING_CREATE`). TASK-048. */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "MARKETING_CREATE");
  const input = await parseJsonBody(request, createCampaignSchema);
  const campaign = await getCampaignsService().createCampaign(employee, input, {
    logger: api.logger,
    correlationId: api.requestId,
  });
  return ok(api.requestId, campaign, { status: 201 });
});
