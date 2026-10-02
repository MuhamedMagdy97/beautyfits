import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody, parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { createSupplierSchema, listSuppliersQuerySchema } from "@/server/modules/suppliers/schemas";
import { getSuppliersService } from "@/server/modules/suppliers/suppliers-service";

/** GET /api/v1/admin/suppliers — list and search suppliers (`SUPPLIER_VIEW`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "SUPPLIER_VIEW");
  const query = parseQuery(request, listSuppliersQuerySchema);
  const page = await getSuppliersService().listSuppliers(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});

/** POST /api/v1/admin/suppliers — create a supplier (`SUPPLIER_MANAGE`). */
export const POST = withApi(async (request, api) => {
  const employee = await requirePermission(request, "SUPPLIER_MANAGE");
  const input = await parseJsonBody(request, createSupplierSchema);
  const supplier = await getSuppliersService().createSupplier(
    { employeeId: employee.employeeId },
    input,
    api.logger,
    api.requestId,
  );
  return ok(api.requestId, supplier, { status: 201 });
});
