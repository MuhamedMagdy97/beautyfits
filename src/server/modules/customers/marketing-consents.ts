import type {
  MarketingChannel,
  MarketingConsentSource,
  PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import type { MarketingConsentsInput } from "@/server/modules/customers/schemas";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Marketing consent ledger (TASK-046, Q59, Q60, User Flows §16.2, ADR-0051).
 *
 * - Explicit opt-in per channel; nothing is pre-enabled: a channel with no
 *   row is not opted in (Q59).
 * - Email and WhatsApp are independent (Q60). Transactional notifications
 *   never read this ledger (Q53).
 * - History is append-only (database trigger): every change is a new row
 *   with its time and source; a request that changes nothing adds nothing.
 * - Writers lock the customer row, so concurrent changes are serialized and
 *   the highest id is always the current state.
 */

export interface ChannelConsent {
  optedIn: boolean;
  /** When the current state was recorded; `null` if the channel was never set. */
  changedAt: Date | null;
}

export type ConsentState = Record<MarketingChannel, ChannelConsent>;

/** The customer's current consent per channel (latest row of each). */
export async function currentConsents(db: Db, customerId: string): Promise<ConsentState> {
  const latest = await db.marketingConsent.findMany({
    where: { customerId },
    orderBy: { id: "desc" },
    distinct: ["channel"],
    select: { channel: true, status: true, occurredAt: true },
  });
  const state: ConsentState = {
    EMAIL: { optedIn: false, changedAt: null },
    WHATSAPP: { optedIn: false, changedAt: null },
  };
  for (const row of latest) {
    state[row.channel] = { optedIn: row.status === "OPTED_IN", changedAt: row.occurredAt };
  }
  return state;
}

/**
 * Appends a row for each channel whose wanted state differs from the current
 * one. Call inside a transaction that holds the customer row lock.
 */
export async function recordConsentChanges(
  tx: Db,
  customerId: string,
  wanted: Partial<Record<MarketingChannel, boolean>>,
  source: MarketingConsentSource,
  now: Date,
): Promise<void> {
  const current = await currentConsents(tx, customerId);
  const changes = (Object.keys(wanted) as MarketingChannel[]).filter(
    (channel) => wanted[channel] !== undefined && wanted[channel] !== current[channel].optedIn,
  );
  if (changes.length === 0) {
    return;
  }
  await tx.marketingConsent.createMany({
    data: changes.map((channel) => ({
      customerId,
      channel,
      status: wanted[channel] ? ("OPTED_IN" as const) : ("OPTED_OUT" as const),
      source,
      occurredAt: now,
    })),
  });
}

/** Opts the customer out of every channel (deactivation, R34). Caller holds the row lock. */
export function optOutEverywhere(tx: Db, customerId: string, now: Date): Promise<void> {
  return recordConsentChanges(
    tx,
    customerId,
    { EMAIL: false, WHATSAPP: false },
    "ACCOUNT_DEACTIVATED",
    now,
  );
}

export interface MarketingConsentsView {
  email: { optedIn: boolean; changedAt: string | null };
  whatsapp: { optedIn: boolean; changedAt: string | null };
}

function toView(state: ConsentState): MarketingConsentsView {
  const channel = (c: ChannelConsent) => ({
    optedIn: c.optedIn,
    changedAt: c.changedAt?.toISOString() ?? null,
  });
  return { email: channel(state.EMAIL), whatsapp: channel(state.WHATSAPP) };
}

export function createMarketingConsentService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  /** `GET /me/marketing-consents`. */
  async function getConsents(customerId: string): Promise<MarketingConsentsView> {
    return toView(await currentConsents(db, customerId));
  }

  /** `PATCH /me/marketing-consents`: opt in or out per channel. */
  async function updateConsents(
    customerId: string,
    input: MarketingConsentsInput,
  ): Promise<MarketingConsentsView> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
        await recordConsentChanges(
          tx,
          customerId,
          { EMAIL: input.email, WHATSAPP: input.whatsapp },
          "CUSTOMER_ACCOUNT",
          now,
        );
        return toView(await currentConsents(tx, customerId));
      },
      {},
      db,
    );
  }

  return { getConsents, updateConsents };
}

export type MarketingConsentService = ReturnType<typeof createMarketingConsentService>;

let defaultService: MarketingConsentService | undefined;

export function getMarketingConsentService(): MarketingConsentService {
  defaultService ??= createMarketingConsentService({ db: getDb(), clock: systemClock });
  return defaultService;
}
