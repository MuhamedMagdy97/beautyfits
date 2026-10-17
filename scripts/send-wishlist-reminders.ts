// Daily job (TASK-043, ADR-0050): `npm run jobs:send-wishlist-reminders`.
// Queues the due wishlist purchase reminders (Business Spec R6: every 3 days,
// at most 3, marketing consent only); `jobs:dispatch-notifications` sends them.
// Safe to run again. Scheduling comes with deployment (TASK-066).
// Each run is recorded in job_runs (TASK-065, ADR-0073).
import { existsSync } from "node:fs";
import { getWishlistRemindersService } from "@/server/modules/wishlist/reminders";
import { runJobScript } from "@/server/observability/job-runner";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

runJobScript("send-wishlist-reminders", async () => {
  const { sent, stopped } = await getWishlistRemindersService().sendDue();
  return { queued: sent, itemsStopped: stopped };
});
