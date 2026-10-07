import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requireEmployee } from "@/server/modules/auth/employee-guard";
import { getNotificationsService } from "@/server/modules/notifications/notifications-service";
import { listNotificationsQuerySchema } from "@/server/modules/notifications/schemas";

/** GET /api/v1/admin/me/notifications — the employee's own notifications, newest first. */
export const GET = withApi(async (request, api) => {
  const employee = await requireEmployee(request);
  const query = parseQuery(request, listNotificationsQuerySchema);
  const page = await getNotificationsService().list({ employeeId: employee.employeeId }, query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
