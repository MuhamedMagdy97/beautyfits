import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getSettingsService } from "@/server/modules/settings/settings-service";

/** GET /api/v1/admin/settings — every setting with its value in effect (`SETTINGS_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "SETTINGS_VIEW");
  return ok(api.requestId, await getSettingsService().listSettings());
});
