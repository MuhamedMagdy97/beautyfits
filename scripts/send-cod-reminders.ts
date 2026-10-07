// Frequent job (TASK-031, Business Spec Q25, Q54, R39): `npm run jobs:send-cod-reminders`.
// Run every few minutes; safe to run again. Scheduling comes with deployment (TASK-066).
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getCodService } from "@/server/modules/orders/cod-service";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
getCodService()
  .sendReminders()
  .then((count) => console.log(`COD reminders queued: ${count}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
