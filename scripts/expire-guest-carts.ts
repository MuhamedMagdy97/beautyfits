// Daily job (TASK-025, Business Spec R35): `npm run jobs:expire-guest-carts`.
// Marks guest carts unchanged for the configured period (default 30 days)
// EXPIRED. Safe to run again. Scheduling comes with deployment (TASK-066).
import { existsSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getCartService } from "@/server/modules/cart/cart-service";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The package is CommonJS for tsx, so no top-level await.
getCartService()
  .expireGuestCarts()
  .then((count) => console.log(`Guest carts expired: ${count}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getDb().$disconnect());
