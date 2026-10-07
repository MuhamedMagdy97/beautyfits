import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getNotificationsService } from "@/server/modules/notifications/notifications-service";

/** POST /api/v1/me/notifications/read-all — mark every notification as read (Q58). */
export const POST = withApi(async (request, api) => {
  const customer = await requireCustomer(request);
  const result = await getNotificationsService().markAllRead({ customerId: customer.customerId });
  return ok(api.requestId, result);
});
