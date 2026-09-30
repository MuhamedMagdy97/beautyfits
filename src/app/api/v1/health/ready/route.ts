import { pingDatabase } from "@/server/db/client";
import { checkReadiness } from "@/server/health/health";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";

/** GET /api/v1/health/ready — readiness. 503 when the database is unreachable. */
export const GET = withApi(async (_request, { requestId, logger }) => {
  const report = await checkReadiness({ pingDatabase, logger });
  return ok(requestId, report, { status: report.status === "ready" ? 200 : 503 });
});
