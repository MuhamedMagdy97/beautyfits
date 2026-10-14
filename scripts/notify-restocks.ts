// Frequent job (TASK-043, ADR-0050): `npm run jobs:notify-restocks`.
// Fulfils the restock (Notify Me) subscriptions of variants that are back in
// stock and queues one message each; `jobs:dispatch-notifications` sends them.
// Safe to run again. Scheduling comes with deployment (TASK-066).
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getRestockService } from "@/server/modules/restock/restock-service";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
getRestockService()
  .notifyRestocked()
  .then(({ notified }) => console.log(`Restock subscriptions notified: ${notified}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
