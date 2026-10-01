import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { permissionCatalogView } from "@/server/modules/rbac/roles-service";

/** GET /api/v1/admin/permissions — the permission catalog (`ROLE_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "ROLE_VIEW");
  return ok(api.requestId, permissionCatalogView());
});
