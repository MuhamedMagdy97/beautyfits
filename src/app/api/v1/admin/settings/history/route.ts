import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { listSettingHistoryQuerySchema } from "@/server/modules/settings/schemas";
import { getSettingsService } from "@/server/modules/settings/settings-service";

/** GET /api/v1/admin/settings/history — applied setting changes, newest first (`SETTINGS_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "SETTINGS_VIEW");
  const query = parseQuery(request, listSettingHistoryQuerySchema);
  const page = await getSettingsService().listHistory(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
