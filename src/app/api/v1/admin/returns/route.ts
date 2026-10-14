import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { listReturnsQuerySchema } from "@/server/modules/returns/schemas";

/** GET /api/v1/admin/returns — search returns, newest first (`RETURNS_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "RETURNS_VIEW");
  const query = parseQuery(request, listReturnsQuerySchema);
  const page = await getReturnsService().listReturns(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
