import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { getDiscountsService } from "@/server/modules/discounts/discounts-service";
import { createDiscountSchema, listDiscountsQuerySchema } from "@/server/modules/discounts/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/** GET /api/v1/admin/discounts — list and search discounts (`DISCOUNT_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "DISCOUNT_VIEW");
  const query = parseQuery(request, listDiscountsQuerySchema);
  const page = await getDiscountsService().listDiscounts(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/** POST /api/v1/admin/discounts — create an inactive discount (`DISCOUNT_MANAGE`). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "DISCOUNT_MANAGE");
  const input = await parseJsonBody(request, createDiscountSchema);
  const discount = await getDiscountsService().createDiscount(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, discount, { status: 201 });
});
