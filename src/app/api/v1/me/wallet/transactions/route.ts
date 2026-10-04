import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { walletTransactionsQuerySchema } from "@/server/modules/wallet/schemas";
import { getWalletService } from "@/server/modules/wallet/wallet-service";

/** GET /api/v1/me/wallet/transactions — the wallet ledger, newest first. */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const query = parseQuery(request, walletTransactionsQuerySchema);
  const page = await getWalletService().listOwnTransactions(customer.customerId, query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
