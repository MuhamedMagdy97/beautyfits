import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { canViewCost } from "@/server/modules/catalog/presentation";
import { getPricingService } from "@/server/modules/catalog/pricing-service";
import { priceReviewSchema } from "@/server/modules/catalog/schemas";
import { permissionDenied, requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/products/{id}/price-review — preview or apply selling prices per variant,
 * by hand or from a target margin (`EDIT_PRODUCT_PRICE`, Q73, Q111, ADR-0023). Margins and
 * warnings are returned to callers with `VIEW_COST_PRICE`; target margins need it too.
 * Body: `{ items: [{ variantId, sellingPrice | targetMarginBasisPoints }], apply?, reason? }`.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/products/[id]/price-review">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "EDIT_PRODUCT_PRICE");
    const id = pathId((await context.params).id, "Product");
    const input = await parseJsonBody(request, priceReviewSchema);
    const costVisible = canViewCost(employee.permissions);
    if (!costVisible && input.items.some((item) => item.targetMarginBasisPoints !== undefined)) {
      throw permissionDenied("A target margin reveals the cost.", {
        requiredPermissions: ["VIEW_COST_PRICE"],
      });
    }
    const review = await getPricingService().reviewPrices(
      { employeeId: employee.employeeId },
      id,
      input,
      { canViewCost: costVisible },
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, review);
  },
);
