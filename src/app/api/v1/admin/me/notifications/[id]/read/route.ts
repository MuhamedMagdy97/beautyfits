import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { requireEmployee } from "@/server/modules/auth/employee-guard";
import { getNotificationsService } from "@/server/modules/notifications/notifications-service";
import { pathId } from "@/server/modules/rbac/http";

/** POST /api/v1/admin/me/notifications/{id}/read — mark one of the employee's own as read. */
export const POST = withApi<RouteContext<"/api/v1/admin/me/notifications/[id]/read">>(
  async (request, api, context) => {
    const employee = await requireEmployee(request);
    const id = pathId((await context.params).id, "Notification");
    const view = await getNotificationsService().markRead({ employeeId: employee.employeeId }, id);
    return ok(api.requestId, view);
  },
);
