import type { NotificationChannel, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { conflict } from "@/server/modules/catalog/errors";
import { variantNotFound } from "@/server/modules/catalog/product-guards";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Restock "Notify Me" (TASK-043, ADR-0050; Business Spec Q47, Q51, Q52, Q62,
 * R12; User Flows §4.2, §16.3; DB design §15).
 *
 * - An explicit subscription per customer and variant, on the channels the
 *   customer picks (email, WhatsApp or both). Being on the wishlist never
 *   subscribes (Q51).
 * - `notifyRestocked` (job `jobs:notify-restocks`) closes every active
 *   subscription whose variant is purchasable again and queues one
 *   `RESTOCK_AVAILABLE` event for it in the same transaction: one message per
 *   restock event (Q52). Another restock needs a new subscription.
 */

export interface RestockSubscriptionView {
  id: string;
  variantId: string;
  channels: NotificationChannel[];
  status: "ACTIVE";
  subscribedAt: string;
}

type SubscriptionRow = {
  id: string;
  productVariantId: string;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  subscribedAt: Date;
};

function toView(row: SubscriptionRow): RestockSubscriptionView {
  return {
    id: row.id,
    variantId: row.productVariantId,
    channels: [
      ...(row.whatsappEnabled ? (["WHATSAPP"] as const) : []),
      ...(row.emailEnabled ? (["EMAIL"] as const) : []),
    ],
    status: "ACTIVE",
    subscribedAt: row.subscribedAt.toISOString(),
  };
}

function activeOf(db: Db, customerId: string, variantId: string) {
  return db.restockSubscription.findFirst({
    where: { customerId, productVariantId: variantId, status: "ACTIVE" },
  });
}

export function createRestockService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function get(customerId: string, variantId: string) {
    const row = await activeOf(db, customerId, variantId);
    return { subscription: row ? toView(row) : null };
  }

  /**
   * Subscribes, or changes the channels of the active subscription. Only for
   * a variant on sale that cannot be bought now (Q20, Q47: Notify Me is the
   * out-of-stock offer).
   */
  async function subscribe(
    customerId: string,
    variantId: string,
    channels: readonly NotificationChannel[],
  ) {
    const now = clock.now();
    const data = {
      emailEnabled: channels.includes("EMAIL"),
      whatsappEnabled: channels.includes("WHATSAPP"),
    };
    return runInTransaction(
      async (tx) => {
        // Same lock as the cart and wishlist: one write per customer at a time.
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: {
            status: true,
            sellingPrice: true,
            product: { select: { status: true } },
            inventoryBalance: { select: { availableQuantity: true } },
          },
        });
        if (variant?.status !== "ACTIVE" || variant.product.status !== "PUBLISHED") {
          throw variantNotFound();
        }
        if (
          variant.sellingPrice !== null &&
          (variant.inventoryBalance?.availableQuantity ?? 0) > 0
        ) {
          throw conflict("This variant is in stock.", { reason: "VARIANT_IN_STOCK" });
        }
        const existing = await activeOf(tx, customerId, variantId);
        const row = existing
          ? await tx.restockSubscription.update({ where: { id: existing.id }, data })
          : await tx.restockSubscription.create({
              data: { ...data, customerId, productVariantId: variantId, subscribedAt: now },
            });
        return { subscription: toView(row) };
      },
      {},
      db,
    );
  }

  /** Cancels the active subscription, if any (idempotent). */
  async function cancel(customerId: string, variantId: string) {
    await db.restockSubscription.updateMany({
      where: { customerId, productVariantId: variantId, status: "ACTIVE" },
      data: { status: "CANCELLED", cancelledAt: clock.now() },
    });
    return { subscription: null };
  }

  /**
   * Fulfils the active subscriptions of purchasable, in-stock variants and
   * queues their messages, atomically. Concurrent runs are safe: the update
   * re-checks `status = 'ACTIVE'` under the row lock.
   */
  async function notifyRestocked(): Promise<{ notified: number }> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        const fulfilled = await tx.$queryRaw<{ id: string }[]>`
          UPDATE restock_subscriptions s
          SET status = 'FULFILLED', fulfilled_at = ${now}
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          JOIN inventory_balances b ON b.product_variant_id = v.id
          WHERE s.product_variant_id = v.id
            AND s.status = 'ACTIVE'
            AND v.status = 'ACTIVE'
            AND p.status = 'PUBLISHED'
            AND v.selling_price IS NOT NULL
            AND b.available_quantity > 0
          RETURNING s.id`;
        if (fulfilled.length > 0) {
          await tx.outboxEvent.createMany({
            data: fulfilled.map(({ id }) => ({
              eventType: "RESTOCK_AVAILABLE",
              aggregateType: "RESTOCK_SUBSCRIPTION",
              aggregateId: id,
              payload: { restockSubscriptionId: id },
              availableAt: now,
              createdAt: now,
            })),
          });
        }
        return { notified: fulfilled.length };
      },
      {},
      db,
    );
  }

  return { get, subscribe, cancel, notifyRestocked };
}

export type RestockService = ReturnType<typeof createRestockService>;

let defaultService: RestockService | undefined;

export function getRestockService(): RestockService {
  defaultService ??= createRestockService({ db: getDb(), clock: systemClock });
  return defaultService;
}
