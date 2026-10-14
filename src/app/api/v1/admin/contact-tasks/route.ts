import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { parseQuery } from "@/server/http/validation";
import { requirePermission } from "@/server/modules/rbac/authorization";
import { getContactTasksService } from "@/server/modules/shipping/contact-tasks-service";
import { listContactTasksQuerySchema } from "@/server/modules/shipping/schemas";

/** GET /api/v1/admin/contact-tasks — customer-contact tasks after failed deliveries (`CONTACT_TASK_MANAGE`). */
export const GET = withApi(async (request, api) => {
  await requirePermission(request, "CONTACT_TASK_MANAGE");
  const query = parseQuery(request, listContactTasksQuerySchema);
  const page = await getContactTasksService().list(query);
  return ok(api.requestId, page.items, { pagination: page.pagination });
});
