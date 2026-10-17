// Frequent job (TASK-043, ADR-0050): `npm run jobs:notify-restocks`.
// Fulfils the restock (Notify Me) subscriptions of variants that are back in
// stock and queues one message each; `jobs:dispatch-notifications` sends them.
// Safe to run again. Scheduling comes with deployment (TASK-066).
// Each run is recorded in job_runs (TASK-065, ADR-0073).
import { existsSync } from "node:fs";
import { getRestockService } from "@/server/modules/restock/restock-service";
import { runJobScript } from "@/server/observability/job-runner";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

runJobScript("notify-restocks", async () => {
  const { notified } = await getRestockService().notifyRestocked();
  return { notified };
});
