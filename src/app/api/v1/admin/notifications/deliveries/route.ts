import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { getNotificationsService } from "@/server/modules/notifications/notifications-service";
import { listDeliveriesQuerySchema } from "@/server/modules/notifications/schemas";
import { requirePermission } from "@/server/modules/rbac/authorization";

/**
 * GET /api/v1/admin/notifications/deliveries — WhatsApp/email delivery
 * attempts and failures (`NOTIFICATION_LOG_VIEW`; recipients need
 * `VIEW_CUSTOMER_CONTACT`).
 */
export const GET = withApi(async (request, api) => {
  const employee = await requirePermission(request, "NOTIFICATION_LOG_VIEW");
  const query = parseQuery(request, listDeliveriesQuerySchema);
  const page = await getNotificationsService().listDeliveries(query, employee.permissions);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
