import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { presentVariant } from "@/server/modules/catalog/presentation";
import { getPricingService } from "@/server/modules/catalog/pricing-service";
import { variantCostSchema } from "@/server/modules/catalog/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * PATCH /api/v1/admin/variants/{id}/cost — type in opening costs before the first goods receipt
 * (`EDIT_COST_PRICE`, Q74, ADR-0023 §4 item 4). Body: `{ latestPurchaseCost?, weightedAverageCost?,
 * reason }`.
 */
export const PATCH = withApi<RouteContext<"/api/v1/admin/variants/[id]/cost">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "EDIT_COST_PRICE");
    const id = pathId((await context.params).id, "Variant");
    const input = await parseJsonBody(request, variantCostSchema);
    const variant = await getPricingService().updateVariantCosts(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, presentVariant(variant, employee.permissions));
  },
);
