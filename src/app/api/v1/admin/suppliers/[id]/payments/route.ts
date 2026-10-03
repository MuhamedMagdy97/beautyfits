import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, requireIdempotencyKey } from "@/server/http/validation";
import { recordSupplierPaymentSchema } from "@/server/modules/purchasing/schemas";
import { getSupplierLedgerService } from "@/server/modules/purchasing/supplier-ledger";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/admin/suppliers/{id}/payments — record a payment to the
 * supplier (`SUPPLIER_PAYMENT_MANAGE`). Requires `Idempotency-Key`.
 */
export const POST = withApi<RouteContext<"/api/v1/admin/suppliers/[id]/payments">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SUPPLIER_PAYMENT_MANAGE");
    const id = pathId((await context.params).id, "Supplier");
    const key = requireIdempotencyKey(request);
    const input = await parseJsonBody(request, recordSupplierPaymentSchema);
    const result = await getSupplierLedgerService().recordPayment(employee, id, input, key, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result, { status: 201 });
  },
);
