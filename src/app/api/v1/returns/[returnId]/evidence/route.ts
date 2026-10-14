import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getReturnsService } from "@/server/modules/returns/returns-service";
import { addReturnEvidenceSchema } from "@/server/modules/returns/schemas";

/**
 * POST /api/v1/returns/{returnId}/evidence — attach the customer's uploaded
 * photos (`RETURN_EVIDENCE`, API §28) while the return waits for approval (Q100).
 */
export const POST = withApi<RouteContext<"/api/v1/returns/[returnId]/evidence">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).returnId, "Return").toLowerCase();
    const { mediaAssetIds } = await parseJsonBody(request, addReturnEvidenceSchema);
    const updated = await getReturnsService().addEvidence(customer.customerId, id, mediaAssetIds, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, updated);
  },
);
