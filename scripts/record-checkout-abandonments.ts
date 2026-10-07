// Periodic job (TASK-050, ADR-0044): `npm run jobs:record-checkout-abandonments`.
// Run hourly; safe to run again. Scheduling comes with deployment (TASK-066).
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getAnalyticsService } from "@/server/modules/analytics/analytics-service";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
getAnalyticsService()
  .recordCheckoutAbandonments()
  .then((count) => console.log(`Checkout abandonments recorded: ${count}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
