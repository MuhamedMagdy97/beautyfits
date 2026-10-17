// Frequent job (TASK-045, ADR-0043): `npm run jobs:dispatch-notifications`.
// Sends the transactional messages of committed outbox events (in-app, then
// WhatsApp with email fallback). Run every minute or so; safe to run again.
// Scheduling comes with deployment (TASK-066).
// Each run is recorded in job_runs (TASK-065, ADR-0073).
import { existsSync } from "node:fs";
import { getNotificationsService } from "@/server/modules/notifications/notifications-service";
import { runJobScript } from "@/server/observability/job-runner";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

runJobScript("dispatch-notifications", async () => {
  const { done, retried, failed } = await getNotificationsService().dispatchPending();
  return { done, retried, failed };
});
