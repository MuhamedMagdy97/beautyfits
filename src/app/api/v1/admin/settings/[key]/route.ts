import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { changeSettingSchema } from "@/server/modules/settings/schemas";
import { getSettingsService } from "@/server/modules/settings/settings-service";

/**
 * PATCH /api/v1/admin/settings/{key} — change a setting, or propose a change
 * of a critical one for approval (`SETTINGS_MANAGE`, Owner/Admin only, Q179, Q180).
 */
export const PATCH = withApi<RouteContext<"/api/v1/admin/settings/[key]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SETTINGS_MANAGE");
    const { key } = await context.params;
    const input = await parseJsonBody(request, changeSettingSchema);
    const result = await getSettingsService().changeSetting(
      employee.employeeId,
      key,
      input,
      api.requestId,
    );
    return ok(api.requestId, result);
  },
);
