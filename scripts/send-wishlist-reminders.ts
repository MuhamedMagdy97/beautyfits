// Daily job (TASK-043, ADR-0050): `npm run jobs:send-wishlist-reminders`.
// Queues the due wishlist purchase reminders (Business Spec R6: every 3 days,
// at most 3, marketing consent only); `jobs:dispatch-notifications` sends them.
// Safe to run again. Scheduling comes with deployment (TASK-066).
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getWishlistRemindersService } from "@/server/modules/wishlist/reminders";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
getWishlistRemindersService()
  .sendDue()
  .then(({ sent, stopped }) =>
    console.log(`Wishlist reminders: ${sent} queued, ${stopped} items stopped`),
  )
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
