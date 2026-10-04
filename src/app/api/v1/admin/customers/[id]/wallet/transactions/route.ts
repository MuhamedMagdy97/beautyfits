import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { walletTransactionsQuerySchema } from "@/server/modules/wallet/schemas";
import { getWalletService } from "@/server/modules/wallet/wallet-service";

/** GET /api/v1/admin/customers/{id}/wallet/transactions — the ledger with reasons (`VIEW_WALLET_BALANCE`). */
export const GET = withApi<RouteContext<"/api/v1/admin/customers/[id]/wallet/transactions">>(
  async (request, api, context) => {
    await requirePermission(request, "VIEW_WALLET_BALANCE");
    const id = pathId((await context.params).id, "Customer");
    const query = parseQuery(request, walletTransactionsQuerySchema);
    const page = await getWalletService().listCustomerTransactions(id, query);
    return ok(api.requestId, page.items, { pagination: page.pagination });
  },
);
