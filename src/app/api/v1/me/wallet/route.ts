import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getWalletService } from "@/server/modules/wallet/wallet-service";

/** GET /api/v1/me/wallet — balance, held and available credit (Q166). */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  return ok(api.requestId, await getWalletService().getWallet(customer.customerId));
});
