import type { NotificationChannel } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";

/**
 * The channels a customer has valid marketing consent for (Business Spec Q59,
 * Q60, R6, v1.1 §9). Used by wishlist purchase reminders (TASK-043).
 *
 * Seam for TASK-046 (marketing consent ledger), which replaces the default
 * with a ledger lookup. Until it lands nobody has opted in — consent is
 * explicit and never pre-enabled (Q59) — so no marketing-style message is sent.
 */
export type MarketingConsentLookup = (
  db: Db,
  customerId: string,
) => Promise<readonly NotificationChannel[]>;

export const marketingConsentChannels: MarketingConsentLookup = () => Promise.resolve([]);
