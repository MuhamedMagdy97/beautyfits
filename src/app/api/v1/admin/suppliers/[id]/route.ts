import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { updateSupplierSchema } from "@/server/modules/suppliers/schemas";
import { getSuppliersService } from "@/server/modules/suppliers/suppliers-service";

/** PATCH /api/v1/admin/suppliers/{id} — edit, deactivate or reactivate a supplier (`SUPPLIER_MANAGE`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/suppliers/[id]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "SUPPLIER_MANAGE");
    const id = pathId((await context.params).id, "Supplier");
    const input = await parseJsonBody(request, updateSupplierSchema);
    const supplier = await getSuppliersService().updateSupplier(
      { employeeId: employee.employeeId },
      id,
      input,
      api.logger,
      api.requestId,
    );
    return ok(api.requestId, supplier);
  },
);
