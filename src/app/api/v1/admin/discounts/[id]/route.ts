import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getDiscountsService } from "@/server/modules/discounts/discounts-service";
import { updateDiscountSchema } from "@/server/modules/discounts/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** PATCH /api/v1/admin/discounts/{id} — edit a discount (`DISCOUNT_MANAGE`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/discounts/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "DISCOUNT_MANAGE");
    const id = pathId((await context.params).id, "Discount");
    const input = await parseJsonBody(request, updateDiscountSchema);
    const discount = await getDiscountsService().updateDiscount(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, discount);
  },
);
