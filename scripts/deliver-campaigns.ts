// Frequent job (TASK-049, ADR-0067): `npm run jobs:deliver-campaigns`.
// Delivers the recipients of SENDING campaigns (consent recheck, frequency
// limit, retries, email fallback) and ends finished campaigns. Run every few
// minutes; safe to run again. Scheduling comes with deployment (TASK-066).
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getCampaignDeliveryService } from "@/server/modules/marketing/delivery-service";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
getCampaignDeliveryService()
  .deliverPending()
  .then(({ sent, skipped, failed, retrying, campaignsEnded }) =>
    console.log(
      `Campaign recipients: ${sent} sent, ${skipped} skipped, ${failed} failed, ${retrying} to retry; ${campaignsEnded} campaigns ended`,
    ),
  )
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
