import type { PrismaClient, WishlistReminderStopReason } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import {
  marketingConsentChannels,
  type MarketingConsentLookup,
} from "@/server/modules/notifications/marketing-consent";
import { MS_PER_DAY, systemClock, type Clock } from "@/server/time/time";

/**
 * Wishlist purchase reminders (TASK-043, ADR-0050; Business Spec R6).
 *
 * Job `jobs:send-wishlist-reminders`. Per wishlist item: one reminder every
 * 3 days, at most 3, only to channels with marketing consent. Each reminder is
 * a `WISHLIST_REMINDER` outbox event written in the same transaction as the
 * item's reminder state; the notification dispatcher sends it (ADR-0043).
 *
 * Stops (recorded in `reminders_stopped_reason`): purchased, unavailable or
 * archived, consent withdrawn, maximum reached. A removed item is deleted, so
 * nothing is left to remind.
 */

export const REMINDER_INTERVAL_MS = 3 * MS_PER_DAY;
export const MAX_REMINDERS = 3;
const BATCH_SIZE = 500;

export function createWishlistRemindersService(deps: {
  db: PrismaClient;
  clock: Clock;
  marketingConsent?: MarketingConsentLookup;
}) {
  const { db, clock } = deps;
  const marketingConsent = deps.marketingConsent ?? marketingConsentChannels;

  async function stop(id: string, reason: WishlistReminderStopReason) {
    await db.wishlistItem.updateMany({
      where: { id, remindersStoppedReason: null },
      data: { remindersStoppedReason: reason },
    });
  }

  async function sendDue(): Promise<{ sent: number; stopped: number }> {
    const now = clock.now();
    const cutoff = new Date(now.getTime() - REMINDER_INTERVAL_MS);
    const result = { sent: 0, stopped: 0 };
    let cursor: string | undefined;
    for (;;) {
      const due = await db.wishlistItem.findMany({
        where: {
          remindersStoppedReason: null,
          // The first reminder 3 days after adding, then every 3 days (R6).
          OR: [
            { lastRemindedAt: { lte: cutoff } },
            { lastRemindedAt: null, createdAt: { lte: cutoff } },
          ],
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        select: {
          id: true,
          createdAt: true,
          reminderCount: true,
          productVariantId: true,
          wishlist: { select: { customerId: true, customer: { select: { anonymizedAt: true } } } },
          variant: {
            select: {
              status: true,
              sellingPrice: true,
              product: { select: { status: true } },
              inventoryBalance: { select: { availableQuantity: true } },
            },
          },
        },
      });
      if (due.length === 0) break;
      cursor = due[due.length - 1].id;

      for (const item of due) {
        const { customerId } = item.wishlist;
        const { variant } = item;
        if (item.wishlist.customer.anonymizedAt) continue;
        if (
          variant.status !== "ACTIVE" ||
          variant.product.status !== "PUBLISHED" ||
          variant.sellingPrice === null
        ) {
          await stop(item.id, "UNAVAILABLE");
          result.stopped += 1;
          continue;
        }
        const purchased = await db.orderItem.count({
          where: {
            productVariantId: item.productVariantId,
            order: {
              customerId,
              status: { notIn: ["CANCELLED", "EXPIRED"] },
              createdAt: { gte: item.createdAt },
            },
          },
        });
        if (purchased > 0) {
          await stop(item.id, "PURCHASED");
          result.stopped += 1;
          continue;
        }
        // Out of stock: Notify Me is the offer (Q47); no reminder, not counted.
        if ((variant.inventoryBalance?.availableQuantity ?? 0) <= 0) continue;
        const consented = await marketingConsent(db, customerId);
        if (consented.length === 0) {
          // Consent withdrawn after a reminder stops them; never given: nothing started.
          if (item.reminderCount > 0) {
            await stop(item.id, "NO_MARKETING_CONSENT");
            result.stopped += 1;
          }
          continue;
        }
        const count = item.reminderCount + 1;
        const queued = await runInTransaction(
          async (tx) => {
            const { count: updated } = await tx.wishlistItem.updateMany({
              where: {
                id: item.id,
                reminderCount: item.reminderCount,
                remindersStoppedReason: null,
              },
              data: {
                reminderCount: count,
                lastRemindedAt: now,
                remindersStoppedReason: count >= MAX_REMINDERS ? "MAX_REMINDERS" : null,
              },
            });
            if (updated === 0) return false; // Another run took it.
            await tx.outboxEvent.create({
              data: {
                eventType: "WISHLIST_REMINDER",
                aggregateType: "WISHLIST_ITEM",
                aggregateId: item.id,
                payload: { wishlistItemId: item.id, customerId, reminderNumber: count },
                availableAt: now,
                createdAt: now,
              },
            });
            return true;
          },
          {},
          db,
        );
        if (queued) result.sent += 1;
      }
    }
    return result;
  }

  return { sendDue };
}

export type WishlistRemindersService = ReturnType<typeof createWishlistRemindersService>;

let defaultService: WishlistRemindersService | undefined;

export function getWishlistRemindersService(): WishlistRemindersService {
  defaultService ??= createWishlistRemindersService({ db: getDb(), clock: systemClock });
  return defaultService;
}
