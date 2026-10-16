import type {
  CampaignRecipientStatus,
  CampaignSkipReason,
  CampaignStatus,
  MarketingChannel,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { getEmailSender, type EmailSender } from "@/server/email/email";
import type { Pagination } from "@/server/http/response";
import { logger as rootLogger, type Logger } from "@/server/logging/logger";
import { currentConsents } from "@/server/modules/customers/marketing-consents";
import {
  campaignNotFound,
  campaignOutcome,
  changeStatus,
  lockCampaign,
} from "@/server/modules/marketing/campaigns";
import type { CampaignDeliveryQuery } from "@/server/modules/marketing/schemas";
import { readMarketingDeliverySettings } from "@/server/modules/settings/settings";
import { MS_PER_DAY, MS_PER_MINUTE, systemClock, type Clock } from "@/server/time/time";
import { getWhatsAppSender, type WhatsAppSender } from "@/server/whatsapp/whatsapp";

/**
 * Campaign delivery (TASK-049, ADR-0067; Business Spec Q143, Q144, v1.1 §9;
 * User Flows §16.2, §16.5; ADR-0043 §3, ADR-0051 §6, ADR-0061 §6).
 *
 * `deliverPending` (job `jobs:deliver-campaigns`) sends the PENDING recipients
 * of SENDING campaigns, after the send hand-off committed. Per recipient, at
 * delivery time:
 * 1. consent to the campaign's channel is read again: an opt-out after "send"
 *    wins (SKIPPED / CONSENT_WITHDRAWN);
 * 2. the address must be deliverable: the profile phone for WhatsApp, the
 *    verified account email for email, never a deactivated profile
 *    (SKIPPED / NO_ADDRESS);
 * 3. the frequency limit (SKIPPED / FREQUENCY_LIMIT);
 * 4. one try per run on the channel; a failure waits `attempt × 5 minutes`.
 *    After the last try a WhatsApp campaign falls back to email only with
 *    email marketing consent and a verified email (Q143, v1.1 §9).
 * Every try is a `notification_deliveries` row (the TASK-045 log). When no
 * recipient is PENDING the campaign ends COMPLETED (or FAILED when nothing
 * was delivered and something failed), audited as the system.
 */

/** A claimed recipient is re-claimable after this (a crashed run). */
export const DELIVERY_LEASE_MS = 15 * MS_PER_MINUTE;
/** Wait before the next try: attempt × this (as ADR-0043 §2). */
export const DELIVERY_RETRY_STEP_MS = 5 * MS_PER_MINUTE;
const BATCH_SIZE = 100;
/** `notification_deliveries.template_key` of campaign messages. */
export const CAMPAIGN_TEMPLATE_KEY = "MARKETING_CAMPAIGN";
/**
 * Subject of the email fallback of a WhatsApp campaign, which has none.
 * Provisional (TASK-049 open items).
 */
export const FALLBACK_EMAIL_SUBJECT = "BeautyFits";

const DELIVERED: CampaignRecipientStatus[] = ["SENT", "FALLBACK_SENT"];

const RECIPIENT_INCLUDE = {
  campaign: { select: { channel: true, subject: true, content: true } },
  customer: {
    select: {
      phone: true,
      preferredLocale: true,
      anonymizedAt: true,
      account: { select: { email: true, emailVerifiedAt: true } },
    },
  },
} as const satisfies Prisma.CampaignRecipientInclude;

type RecipientRow = Prisma.CampaignRecipientGetPayload<{ include: typeof RECIPIENT_INCLUDE }>;

/** The deliverable address of a channel, or null. */
function addressOf(row: RecipientRow, channel: MarketingChannel): string | null {
  const { customer } = row;
  if (customer.anonymizedAt) return null; // Q154: a deactivated profile is wiped.
  if (channel === "WHATSAPP") return customer.phone || null;
  return customer.account?.emailVerifiedAt ? customer.account.email : null;
}

/** Short, single-line failure text (no message content). */
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 500);
}

export interface CampaignDeliveryView {
  campaignId: string;
  status: CampaignStatus;
  stats: {
    recipients: number;
    byStatus: Record<CampaignRecipientStatus, number>;
    skipped: Record<CampaignSkipReason, number>;
    attempts: Record<MarketingChannel, { sent: number; failed: number }>;
  };
  recipients: {
    id: string;
    customerId: string;
    channel: MarketingChannel;
    status: CampaignRecipientStatus;
    skipReason: CampaignSkipReason | null;
    failureReason: string | null;
    attemptCount: number;
    nextAttemptAt: string | null;
    sentAt: string | null;
    attempts: {
      attemptNumber: number;
      channel: string;
      status: string;
      failureReason: string | null;
      createdAt: string;
      sentAt: string | null;
    }[];
  }[];
}

export function createCampaignDeliveryService(deps: {
  db: PrismaClient;
  clock: Clock;
  email?: EmailSender;
  whatsapp?: WhatsAppSender;
  logger?: Logger;
}) {
  const { db, clock } = deps;
  const email = () => deps.email ?? getEmailSender();
  const whatsapp = () => deps.whatsapp ?? getWhatsAppSender();
  const log = deps.logger ?? rootLogger;

  async function finish(
    id: string,
    data: Prisma.CampaignRecipientUpdateInput,
  ): Promise<CampaignRecipientStatus> {
    await db.campaignRecipient.update({ where: { id }, data: { ...data, nextAttemptAt: null } });
    return data.status as CampaignRecipientStatus;
  }

  function skip(id: string, reason: CampaignSkipReason) {
    return finish(id, { status: "SKIPPED", skipReason: reason });
  }

  /** One logged try. Returns the failure text, or null when it was sent. */
  async function attempt(
    row: RecipientRow,
    channel: MarketingChannel,
    to: string,
    fallback: boolean,
  ): Promise<string | null> {
    const attemptNumber =
      (await db.notificationDelivery.count({
        where: { campaignRecipientId: row.id },
      })) + 1;
    const delivery = await db.notificationDelivery.create({
      data: {
        campaignRecipientId: row.id,
        templateKey: CAMPAIGN_TEMPLATE_KEY,
        locale: row.customer.preferredLocale,
        channel,
        recipient: to,
        attemptNumber,
        status: "PENDING",
        createdAt: clock.now(),
      },
    });
    const { content, subject } = row.campaign;
    try {
      let reference: string | null = null;
      if (channel === "WHATSAPP") {
        reference = (await whatsapp().send({ to, text: content })).reference;
      } else {
        await email().send({ to, subject: subject ?? FALLBACK_EMAIL_SUBJECT, text: content });
      }
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: fallback ? "FALLBACK_SENT" : "SENT",
          providerReference: reference,
          sentAt: clock.now(),
        },
      });
      return null;
    } catch (error) {
      const reason = reasonOf(error);
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", failureReason: reason },
      });
      return reason;
    }
  }

  /** Campaign messages delivered to the customer since `since` (Q144). */
  function deliveredSince(customerId: string, since: Date): Promise<number> {
    return db.campaignRecipient.count({
      where: { customerId, status: { in: DELIVERED }, sentAt: { gte: since } },
    });
  }

  /** Handles one claimed recipient (`attempt` = this run's number). */
  async function deliverOne(
    row: RecipientRow,
    tryNumber: number,
    settings: Awaited<ReturnType<typeof readMarketingDeliverySettings>>,
  ): Promise<CampaignRecipientStatus> {
    const { channel } = row.campaign;
    const consents = await currentConsents(db, row.customerId);
    if (!consents[channel].optedIn) return skip(row.id, "CONSENT_WITHDRAWN");
    const to = addressOf(row, channel);
    if (!to) return skip(row.id, "NO_ADDRESS");
    if (settings.frequencyMaxMessages > 0) {
      // ponytail: two runs delivering to one customer at once may pass the limit by one; lock the customer row if that matters.
      const since = new Date(clock.now().getTime() - settings.frequencyWindowDays * MS_PER_DAY);
      if ((await deliveredSince(row.customerId, since)) >= settings.frequencyMaxMessages) {
        return skip(row.id, "FREQUENCY_LIMIT");
      }
    }

    const failure = await attempt(row, channel, to, false);
    if (failure === null) {
      return finish(row.id, { status: "SENT", sentAt: clock.now(), failureReason: null });
    }
    if (tryNumber < settings.maxAttempts) {
      await db.campaignRecipient.update({
        where: { id: row.id },
        data: {
          failureReason: failure,
          nextAttemptAt: new Date(clock.now().getTime() + tryNumber * DELIVERY_RETRY_STEP_MS),
        },
      });
      return "PENDING";
    }

    // Q143: retry, then email fallback, only with email marketing consent (v1.1 §9).
    const fallbackTo = channel === "WHATSAPP" ? addressOf(row, "EMAIL") : null;
    if (fallbackTo && consents.EMAIL.optedIn) {
      const fallbackFailure = await attempt(row, "EMAIL", fallbackTo, true);
      if (fallbackFailure === null) {
        return finish(row.id, { status: "FALLBACK_SENT", sentAt: clock.now() });
      }
      return finish(row.id, { status: "FAILED", failureReason: fallbackFailure });
    }
    return finish(row.id, { status: "FAILED", failureReason: failure });
  }

  /** Ends the SENDING campaigns that have no PENDING recipient left. */
  async function finishCampaigns(): Promise<number> {
    const done = await db.campaign.findMany({
      where: { status: "SENDING", recipients: { none: { status: "PENDING" } } },
      select: { id: true },
    });
    let finished = 0;
    for (const { id } of done) {
      const ended = await runInTransaction(
        async (tx) => {
          if ((await lockCampaign(tx, id)) !== "SENDING") return false;
          const groups = await tx.campaignRecipient.groupBy({
            by: ["status"],
            where: { campaignId: id },
            _count: { _all: true },
          });
          const count = (s: CampaignRecipientStatus) =>
            groups.find((g) => g.status === s)?._count._all ?? 0;
          if (count("PENDING") > 0) return false;
          const details = {
            sent: count("SENT"),
            fallbackSent: count("FALLBACK_SENT"),
            failed: count("FAILED"),
            skipped: count("SKIPPED"),
          };
          const to = campaignOutcome({
            delivered: details.sent + details.fallbackSent,
            failed: details.failed,
          });
          await changeStatus(
            tx,
            id,
            "SENDING",
            to,
            to === "COMPLETED" ? "CAMPAIGN_COMPLETED" : "CAMPAIGN_FAILED",
            { employeeId: null, now: clock.now(), correlationId: null, details },
          );
          log.info("campaign delivery ended", { campaignId: id, status: to, ...details });
          return true;
        },
        {},
        db,
      );
      if (ended) finished += 1;
    }
    return finished;
  }

  /**
   * Delivers the due recipients once, then ends finished campaigns. Safe to
   * run at any time and from several processes: each recipient is claimed
   * with a conditional update.
   */
  async function deliverPending(): Promise<{
    sent: number;
    skipped: number;
    failed: number;
    retrying: number;
    campaignsEnded: number;
  }> {
    const settings = await readMarketingDeliverySettings(db, log);
    const now = clock.now();
    const due = await db.campaignRecipient.findMany({
      where: {
        status: "PENDING",
        campaign: { status: "SENDING" },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      include: RECIPIENT_INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    });
    const result = { sent: 0, skipped: 0, failed: 0, retrying: 0, campaignsEnded: 0 };
    for (const row of due) {
      const tryNumber = row.attemptCount + 1;
      const { count } = await db.campaignRecipient.updateMany({
        where: { id: row.id, status: "PENDING", attemptCount: row.attemptCount },
        data: {
          attemptCount: tryNumber,
          nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS),
        },
      });
      if (count === 0) continue; // Another run has it.
      try {
        const status = await deliverOne(row, tryNumber, settings);
        if (status === "SKIPPED") result.skipped += 1;
        else if (status === "FAILED") result.failed += 1;
        else if (status === "PENDING") result.retrying += 1;
        else result.sent += 1;
      } catch (error) {
        // Left PENDING with its lease: picked up again after DELIVERY_LEASE_MS.
        log.error("campaign delivery error", { recipientId: row.id, error: reasonOf(error) });
      }
    }
    result.campaignsEnded = await finishCampaigns();
    return result;
  }

  /** `GET /admin/campaigns/{id}/delivery` (`MARKETING_VIEW`). */
  async function getDelivery(
    campaignId: string,
    query: CampaignDeliveryQuery,
  ): Promise<{ view: CampaignDeliveryView; pagination: Pagination }> {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!campaign) throw campaignNotFound();
    const where: Prisma.CampaignRecipientWhereInput = {
      campaignId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [byStatus, bySkip, attempts, total, rows] = await Promise.all([
      db.campaignRecipient.groupBy({
        by: ["status"],
        where: { campaignId },
        _count: { _all: true },
      }),
      db.campaignRecipient.groupBy({
        by: ["skipReason"],
        where: { campaignId, status: "SKIPPED" },
        _count: { _all: true },
      }),
      db.notificationDelivery.groupBy({
        by: ["channel", "status"],
        where: { campaignRecipient: { campaignId } },
        _count: { _all: true },
      }),
      db.campaignRecipient.count({ where }),
      db.campaignRecipient.findMany({
        where,
        include: { deliveries: { orderBy: { attemptNumber: "asc" } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const statusCounts: Record<CampaignRecipientStatus, number> = {
      PENDING: 0,
      SENT: 0,
      FALLBACK_SENT: 0,
      FAILED: 0,
      SKIPPED: 0,
    };
    for (const g of byStatus) statusCounts[g.status] = g._count._all;
    const skipped: Record<CampaignSkipReason, number> = {
      CONSENT_WITHDRAWN: 0,
      FREQUENCY_LIMIT: 0,
      NO_ADDRESS: 0,
    };
    for (const g of bySkip) if (g.skipReason) skipped[g.skipReason] = g._count._all;
    const attemptCounts: Record<MarketingChannel, { sent: number; failed: number }> = {
      EMAIL: { sent: 0, failed: 0 },
      WHATSAPP: { sent: 0, failed: 0 },
    };
    for (const g of attempts) {
      if (g.status === "FAILED") attemptCounts[g.channel].failed += g._count._all;
      else if (g.status !== "PENDING") attemptCounts[g.channel].sent += g._count._all;
    }
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return {
      view: {
        campaignId,
        status: campaign.status,
        stats: {
          recipients: Object.values(statusCounts).reduce((a, b) => a + b, 0),
          byStatus: statusCounts,
          skipped,
          attempts: attemptCounts,
        },
        recipients: rows.map((r) => ({
          id: r.id,
          customerId: r.customerId,
          channel: r.channel,
          status: r.status,
          skipReason: r.skipReason,
          failureReason: r.failureReason,
          attemptCount: r.attemptCount,
          nextAttemptAt: r.status === "PENDING" ? iso(r.nextAttemptAt) : null,
          sentAt: iso(r.sentAt),
          attempts: r.deliveries.map((d) => ({
            attemptNumber: d.attemptNumber,
            channel: d.channel,
            status: d.status,
            failureReason: d.failureReason,
            createdAt: d.createdAt.toISOString(),
            sentAt: iso(d.sentAt),
          })),
        })),
      },
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  return { deliverPending, getDelivery };
}

export type CampaignDeliveryService = ReturnType<typeof createCampaignDeliveryService>;

let defaultService: CampaignDeliveryService | undefined;

export function getCampaignDeliveryService(): CampaignDeliveryService {
  defaultService ??= createCampaignDeliveryService({ db: getDb(), clock: systemClock });
  return defaultService;
}
