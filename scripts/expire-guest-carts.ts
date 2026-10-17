// Daily job (TASK-025, Business Spec R35): `npm run jobs:expire-guest-carts`.
// Marks guest carts unchanged for the configured period (default 30 days)
// EXPIRED. Safe to run again. Scheduling comes with deployment (TASK-066).
// Each run is recorded in job_runs (TASK-065, ADR-0073).
import { existsSync } from "node:fs";
import { getCartService } from "@/server/modules/cart/cart-service";
import { runJobScript } from "@/server/observability/job-runner";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

runJobScript("expire-guest-carts", async () => ({
  cartsExpired: await getCartService().expireGuestCarts(),
}));
