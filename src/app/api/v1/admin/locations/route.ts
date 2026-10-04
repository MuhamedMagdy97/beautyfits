import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getLocationsService } from "@/server/modules/locations/locations-service";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/locations — every governorate and area, both languages (`SHIPPING_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "SHIPPING_VIEW");
  return ok(api.requestId, await getLocationsService().listAdmin());
});
