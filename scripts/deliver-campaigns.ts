// Frequent job (TASK-049, ADR-0067): `npm run jobs:deliver-campaigns`.
// Delivers the recipients of SENDING campaigns (consent recheck, frequency
// limit, retries, email fallback) and ends finished campaigns. Run every few
// minutes; safe to run again. Scheduling comes with deployment (TASK-066).
// Each run is recorded in job_runs (TASK-065, ADR-0073).
import { existsSync } from "node:fs";
import { getCampaignDeliveryService } from "@/server/modules/marketing/delivery-service";
import { runJobScript } from "@/server/observability/job-runner";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

runJobScript("deliver-campaigns", async () => {
  const { sent, skipped, failed, retrying, campaignsEnded } =
    await getCampaignDeliveryService().deliverPending();
  return { sent, skipped, failed, retrying, campaignsEnded };
});
