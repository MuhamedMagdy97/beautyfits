import { getClientIp } from "@/server/http/client-ip";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { getAnalyticsService } from "@/server/modules/analytics/analytics-service";
import { analyticsVisitor } from "@/server/modules/analytics/http";
import { clientEventSchema } from "@/server/modules/analytics/schemas";
import { cartOwner } from "@/server/modules/cart/http";

/**
 * POST /api/v1/analytics/events — a Product View or Checkout Started from
 * the website or app (TASK-050). `202` with `{ recorded }`.
 */
export const POST = withApi(async (request, api) => {
  const owner = await cartOwner(request);
  const input = await parseJsonBody(request, clientEventSchema);
  const result = await getAnalyticsService().trackClientEvent(
    owner,
    analyticsVisitor(request, owner),
    input,
    { ip: getClientIp(request), userAgent: request.headers.get("user-agent") },
  );
  return ok(api.requestId, result, { status: 202 });
});
