import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { pathId } from "@/server/modules/rbac/http";
import { getRestockService } from "@/server/modules/restock/restock-service";
import { restockSubscriptionSchema } from "@/server/modules/restock/schemas";

type Context = RouteContext<"/api/v1/variants/[variantId]/restock-subscription">;

/** GET /api/v1/variants/{variantId}/restock-subscription — the active subscription, or null. */
export const GET = withApi<Context>(async (request, api, context) => {
  const customer = await requireCustomer(request);
  const id = pathId((await context.params).variantId, "Variant");
  return ok(api.requestId, await getRestockService().get(customer.customerId, id));
});

/** POST /api/v1/variants/{variantId}/restock-subscription — Notify Me (R12); sets the channels. */
export const POST = withApi<Context>(async (request, api, context) => {
  const customer = await requireCustomer(request);
  const id = pathId((await context.params).variantId, "Variant");
  const input = await parseJsonBody(request, restockSubscriptionSchema);
  return ok(
    api.requestId,
    await getRestockService().subscribe(customer.customerId, id, input.channels),
  );
});

/** DELETE /api/v1/variants/{variantId}/restock-subscription — cancel (idempotent). */
export const DELETE = withApi<Context>(async (request, api, context) => {
  const customer = await requireCustomer(request);
  const id = pathId((await context.params).variantId, "Variant");
  return ok(api.requestId, await getRestockService().cancel(customer.customerId, id));
});
