import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import {
  createShippingRuleSchema,
  listShippingRulesQuerySchema,
} from "@/server/modules/shipping/schemas";
import { getShippingService } from "@/server/modules/shipping/shipping-service";

/** GET /api/v1/admin/shipping/rules — list shipping rules (`SHIPPING_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "SHIPPING_VIEW");
  const query = parseQuery(request, listShippingRulesQuerySchema);
  const page = await getShippingService().listRules(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/** POST /api/v1/admin/shipping/rules — create a shipping rule (`SHIPPING_MANAGE`). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "SHIPPING_MANAGE");
  const input = await parseJsonBody(request, createShippingRuleSchema);
  const rule = await getShippingService().createRule(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, rule, { status: 201 });
});
