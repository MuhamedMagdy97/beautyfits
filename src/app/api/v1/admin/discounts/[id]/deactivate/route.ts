import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getDiscountsService } from "@/server/modules/discounts/discounts-service";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/discounts/{id}/deactivate — Deactivate a discount (`DISCOUNT_MANAGE`). */
export const POST = withApi<RouteContext<"/api/v1/admin/discounts/[id]/deactivate">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "DISCOUNT_MANAGE");
    const id = pathId((await context.params).id, "Discount");
    const discount = await getDiscountsService().setDiscountStatus(
      { employeeId: employee.employeeId },
      id,
      "INACTIVE",
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, discount);
  },
);
