import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, requireIdempotencyKey } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { adjustWalletSchema } from "@/server/modules/wallet/schemas";
import { getWalletService } from "@/server/modules/wallet/wallet-service";

/**
 * POST /api/v1/admin/customers/{id}/wallet/adjust — manual credit or debit
 * with a reason (`ADJUST_WALLET`, Owner/Admin only, Q78). Requires `Idempotency-Key`.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/customers/[id]/wallet/adjust">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "ADJUST_WALLET");
    const id = pathId((await context.params).id, "Customer");
    const key = requireIdempotencyKey(request);
    const input = await parseJsonBody(request, adjustWalletSchema);
    const result = await getWalletService().adjust(employee, id, input, key, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result, { status: 201 });
  },
);
