import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getInventoryService } from "@/server/modules/inventory/inventory-service";
import { adjustInventorySchema } from "@/server/modules/inventory/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/inventory/{variantId}/adjust — manual stock adjustment with a required reason
 * (`ADJUST_INVENTORY`, Q71, Q72, ADR-0024). Body: `{ type, quantity, reason }`; `type` is
 * `MANUAL_ADJUSTMENT` (signed quantity, Available), `DAMAGE` (Available → Damaged) or
 * `DAMAGE_WRITE_OFF` (Damaged out).
 */
export const POST = withApi<RouteContext<"/api/v1/admin/inventory/[variantId]/adjust">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "ADJUST_INVENTORY");
    const id = pathId((await context.params).variantId, "Variant");
    const input = await parseJsonBody(request, adjustInventorySchema);
    const result = await getInventoryService().adjust(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, result);
  },
);
