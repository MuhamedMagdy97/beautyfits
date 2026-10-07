import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getNotificationsService } from "@/server/modules/notifications/notifications-service";
import { listNotificationsQuerySchema } from "@/server/modules/notifications/schemas";

/** GET /api/v1/me/notifications — the customer's notifications, newest first (Q58). */
export const GET = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const query = parseQuery(request, listNotificationsQuerySchema);
  const page = await getNotificationsService().list({ customerId: customer.customerId }, query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
