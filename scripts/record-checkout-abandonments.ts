// Periodic job (TASK-050, ADR-0044): `npm run jobs:record-checkout-abandonments`.
// Run hourly; safe to run again. Scheduling comes with deployment (TASK-066).
// Each run is recorded in job_runs (TASK-065, ADR-0073).
import { existsSync } from "node:fs";
import { getAnalyticsService } from "@/server/modules/analytics/analytics-service";
import { runJobScript } from "@/server/observability/job-runner";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

runJobScript("record-checkout-abandonments", async () => ({
  abandonmentsRecorded: await getAnalyticsService().recordCheckoutAbandonments(),
}));
