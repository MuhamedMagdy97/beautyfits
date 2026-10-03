import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getSupplierLedgerService } from "@/server/modules/purchasing/supplier-ledger";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * GET /api/v1/admin/suppliers/{id}/balance — what we owe the supplier, with
 * Paid / Partially Paid / Unpaid per purchase order (`SUPPLIER_FINANCE_VIEW`, Q118, Q119).
 */
export const GET = withApi<RouteContext<"/api/v1/admin/suppliers/[id]/balance">>(
  async (request, api, context) => {
    await requirePermission(request, "SUPPLIER_FINANCE_VIEW");
    const id = pathId((await context.params).id, "Supplier");
    return ok(api.requestId, await getSupplierLedgerService().getBalance(id));
  },
);
