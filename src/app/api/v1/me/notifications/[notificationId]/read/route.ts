import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireCustomer } from "@/server/modules/auth/guard";
import { getNotificationsService } from "@/server/modules/notifications/notifications-service";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/me/notifications/{notificationId}/read — mark one as read (Q58). */
export const POST = withApi<RouteContext<"/api/v1/me/notifications/[notificationId]/read">>(
  async (request, api, context) => {
    const customer = await requireCustomer(request);
    const id = pathId((await context.params).notificationId, "Notification");
    const view = await getNotificationsService().markRead({ customerId: customer.customerId }, id);
    return ok(api.requestId, view);
  },
);
