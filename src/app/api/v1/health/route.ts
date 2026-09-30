import { checkLiveness } from "@/server/health/health";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";

/** GET /api/v1/health — liveness. No dependency checks. */
export const GET = withApi(async (_request, { requestId }) => ok(requestId, checkLiveness()));
