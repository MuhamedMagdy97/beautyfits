import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { pathId } from "@/server/modules/rbac/http";
import { getContactTasksService } from "@/server/modules/shipping/contact-tasks-service";
import { updateContactTaskSchema } from "@/server/modules/shipping/schemas";

/** PATCH /api/v1/admin/contact-tasks/{taskId} — assign, record the outcome, resolve (`CONTACT_TASK_MANAGE`). */
export const PATCH = withApi<RouteContext<"/api/v1/admin/contact-tasks/[taskId]">>(
  async (request, api, context) => {
    const employee = await requirePermission(request, "CONTACT_TASK_MANAGE");
    const id = pathId((await context.params).taskId, "Contact task");
    const input = await parseJsonBody(request, updateContactTaskSchema);
    const task = await getContactTasksService().update(employee, id, input, {
      logger: api.logger,
      correlationId: api.requestId,
    });
    return ok(api.requestId, task);
  },
);
