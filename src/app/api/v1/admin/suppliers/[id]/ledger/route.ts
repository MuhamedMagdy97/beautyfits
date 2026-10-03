import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { supplierLedgerQuerySchema } from "@/server/modules/purchasing/schemas";
import { getSupplierLedgerService } from "@/server/modules/purchasing/supplier-ledger";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/** GET /api/v1/admin/suppliers/{id}/ledger — ledger entries, newest first (`SUPPLIER_FINANCE_VIEW`). */
export const GET = withApi<RouteContext<"/api/v1/admin/suppliers/[id]/ledger">>(
  async (request, api, context) => {
    await requirePermission(request, "SUPPLIER_FINANCE_VIEW");
    const id = pathId((await context.params).id, "Supplier");
    const query = parseQuery(request, supplierLedgerQuerySchema);
    const page = await getSupplierLedgerService().listLedger(id, query);
    return ok(api.requestId, page.items, { pagination: page.pagination });
  },
);
