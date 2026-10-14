import type { NotificationChannel } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import { currentConsents } from "@/server/modules/customers/marketing-consents";

/**
 * The channels a customer has valid marketing consent for (Business Spec Q59,
 * Q60, R6, v1.1 §9). Used by wishlist purchase reminders (TASK-043).
 *
 * Reads the marketing consent ledger (TASK-046, ADR-0051): a channel counts
 * only while its latest ledger row is an opt-in; no row means not opted in.
 */
export type MarketingConsentLookup = (
  db: Db,
  customerId: string,
) => Promise<readonly NotificationChannel[]>;

export const marketingConsentChannels: MarketingConsentLookup = async (db, customerId) => {
  const consents = await currentConsents(db, customerId);
  const channels: NotificationChannel[] = [];
  if (consents.WHATSAPP.optedIn) channels.push("WHATSAPP");
  if (consents.EMAIL.optedIn) channels.push("EMAIL");
  return channels;
};
