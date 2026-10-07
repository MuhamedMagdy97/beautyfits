// Frequent job (TASK-045, ADR-0043): `npm run jobs:dispatch-notifications`.
// Sends the transactional messages of committed outbox events (in-app, then
// WhatsApp with email fallback). Run every minute or so; safe to run again.
// Scheduling comes with deployment (TASK-066).
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getNotificationsService } from "@/server/modules/notifications/notifications-service";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
getNotificationsService()
  .dispatchPending()
  .then(({ done, retried, failed }) =>
    console.log(`Notification events: ${done} done, ${retried} to retry, ${failed} failed`),
  )
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
