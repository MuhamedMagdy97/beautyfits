// Frequent job (TASK-031, Business Spec Q25, Q54, R39): `npm run jobs:expire-cod-orders`.
// Run every few minutes; safe to run again. Scheduling comes with deployment (TASK-066).
// Each run is recorded in job_runs (TASK-065, ADR-0073).
import { existsSync } from "node:fs";
import { getCodService } from "@/server/modules/orders/cod-service";
import { runJobScript } from "@/server/observability/job-runner";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

runJobScript("expire-cod-orders", async () => ({
  ordersExpired: await getCodService().expireOrders(),
}));
