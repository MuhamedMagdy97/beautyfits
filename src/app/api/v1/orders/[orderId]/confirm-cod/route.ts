import { getClientIp } from "@/server/http/client-ip";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getCodService } from "@/server/modules/orders/cod-service";
import { confirmCodSchema } from "@/server/modules/orders/schemas";
import { pathId } from "@/server/modules/rbac/http";

/**
 * POST /api/v1/orders/{orderId}/confirm-cod — the WhatsApp secure link
 * confirms a COD order; the System then moves it to New (R1, R10). No
 * sign-in: the token is the authorization. Only confirms (R16).
 */
export const POST = withApi<RouteContext<"/api/v1/orders/[orderId]/confirm-cod">>(
  async (request, api, context) => {
    const id = pathId((await context.params).orderId, "Order");
    const { token } = await parseJsonBody(request, confirmCodSchema);
    const result = await getCodService().confirmByLink(id, token, getClientIp(request), {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, result);
  },
);
