import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getWalletService } from "@/server/modules/wallet/wallet-service";

/** GET /api/v1/admin/customers/{id}/wallet — a customer's wallet (`VIEW_WALLET_BALANCE`). */
export const GET = withApi<RouteContext<"/api/v1/admin/customers/[id]/wallet">>(
  async (request, api, context) => {
    await requirePermission(request, "VIEW_WALLET_BALANCE");
    const id = pathId((await context.params).id, "Customer");
    return ok(api.requestId, await getWalletService().getCustomerWallet(id));
  },
);
