import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors/app-error";
import type { Logger } from "@/server/logging/logger";
import type { ClientEventInput } from "@/server/modules/analytics/schemas";
import { liveGuestCart, type CartOwner } from "@/server/modules/cart/cart-service";
import {
  getBlockedUntil,
  recordHit,
  secondsUntil,
  type RateLimitPolicy,
} from "@/server/rate-limit/rate-limit";
import { MS_PER_HOUR, MS_PER_MINUTE, systemClock, type Clock } from "@/server/time/time";

/**
 * Analytics event collection (TASK-050; Business Spec Q145–Q148, R35;
 * User Flows §19; Architecture §18; ADR-0044).
 *
 * - Clients submit Product View and Checkout Started (`POST /analytics/events`,
 *   rate limited per IP, obvious bots ignored). The server records Add to
 *   Cart and Order Created itself after the business write succeeded, and a
 *   job records Checkout Abandoned.
 * - A visitor is a signed-in customer or the random `X-Anonymous-Id` the
 *   client keeps (Q146). No IP address, user agent or contact data is stored.
 * - Analytics never decides anything and never fails the business request
 *   that triggered it (`trackSafely`).
 */

/** Client-submitted events per IP (ADR-0044): 1000 per hour. */
export const ANALYTICS_IP_LIMIT: RateLimitPolicy = {
  limit: 1000,
  windowMs: MS_PER_HOUR,
  blockMs: MS_PER_HOUR,
};

/** A repeated view of the same product by the same visitor within this time is refresh noise (Q145). */
export const PRODUCT_VIEW_REPEAT_MS = 30 * MS_PER_MINUTE;

/**
 * An open checkout start with no order after this time is abandoned.
 * [BUSINESS DECISION REQUIRED] provisional value, see TASK-050 open items.
 */
export const CHECKOUT_ABANDONMENT_MS = 24 * MS_PER_HOUR;

const ABANDONMENT_BATCH = 500;

const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests|httpclient/i;

/** Obvious automated clients (Q145): a crawler-like or missing user agent. */
export function isLikelyBot(userAgent: string | null): boolean {
  return !userAgent?.trim() || BOT_USER_AGENT.test(userAgent);
}

export interface Visitor {
  customerId: string | null;
  anonymousId: string | null;
}

export function createAnalyticsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function insert(
    visitor: Visitor,
    event: {
      eventType: "PRODUCT_VIEW" | "ADD_TO_CART" | "CHECKOUT_STARTED" | "ORDER_CREATED";
      entityType: "PRODUCT" | "CART" | "ORDER";
      entityId: string;
      metadata?: Record<string, string | number>;
      dedupeKey?: string;
    },
    now: Date,
  ): Promise<boolean> {
    // ON CONFLICT DO NOTHING on the dedupe key: a replay records nothing.
    const { count } = await db.analyticsEvent.createMany({
      data: [
        {
          anonymousId: visitor.anonymousId,
          customerId: visitor.customerId,
          eventType: event.eventType,
          entityType: event.entityType,
          entityId: event.entityId,
          metadata: event.metadata ?? {},
          dedupeKey: event.dedupeKey ?? null,
          occurredAt: now,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  }

  /** The owner's active, non-empty cart id, or null. */
  async function activeCartId(owner: CartOwner, now: Date): Promise<string | null> {
    if (owner.kind === "guest" && owner.token === null) {
      return null;
    }
    const cart = await db.cart.findFirst({
      where: {
        ...(owner.kind === "customer"
          ? { customerId: owner.customerId, status: "ACTIVE" as const }
          : await liveGuestCart(db, owner.token!, now)),
        items: { some: {} },
      },
      select: { id: true },
    });
    return cart?.id ?? null;
  }

  /**
   * `POST /analytics/events`. Returns whether the event was stored: bots,
   * refresh repeats, unknown products, a checkout without a cart and an
   * already open checkout start are accepted but not stored.
   */
  async function trackClientEvent(
    owner: CartOwner,
    visitor: Visitor,
    input: ClientEventInput,
    request: { ip: string | null; userAgent: string | null },
  ): Promise<{ recorded: boolean }> {
    const now = clock.now();
    const ipKey = `analytics:ip:${request.ip ?? "unknown"}`;
    const until = await getBlockedUntil(db, ipKey, now);
    if (until) {
      throw new AppError("RATE_LIMITED", "Too many events. Try again later.", {
        details: { retryAfterSeconds: secondsUntil(until, now) },
      });
    }
    await recordHit(db, ipKey, ANALYTICS_IP_LIMIT, now);

    if (visitor.customerId === null && visitor.anonymousId === null) {
      throw new AppError("VALIDATION_ERROR", "Request validation failed.", {
        details: {
          issues: [
            {
              path: "X-Anonymous-Id",
              code: "required",
              message: "Guests send the X-Anonymous-Id header (a UUID).",
            },
          ],
        },
      });
    }
    if (isLikelyBot(request.userAgent)) {
      return { recorded: false };
    }

    if (input.eventType === "PRODUCT_VIEW") {
      const product = await db.product.findFirst({
        where: { id: input.productId, status: "PUBLISHED" },
        select: { id: true },
      });
      if (!product) {
        return { recorded: false };
      }
      const repeat = await db.analyticsEvent.findFirst({
        where: {
          eventType: "PRODUCT_VIEW",
          entityId: product.id,
          occurredAt: { gt: new Date(now.getTime() - PRODUCT_VIEW_REPEAT_MS) },
          ...(visitor.customerId
            ? { customerId: visitor.customerId }
            : { anonymousId: visitor.anonymousId }),
        },
        select: { id: true },
      });
      if (repeat) {
        return { recorded: false };
      }
      return {
        recorded: await insert(
          visitor,
          { eventType: "PRODUCT_VIEW", entityType: "PRODUCT", entityId: product.id },
          now,
        ),
      };
    }

    const cartId = await activeCartId(owner, now);
    if (!cartId) {
      return { recorded: false };
    }
    // One open start per cart: the next one counts after it was abandoned
    // (an order converts the cart, so its next checkout is a new cart).
    const open = await db.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM analytics_events s
      WHERE s.event_type = 'CHECKOUT_STARTED' AND s.entity_id = ${cartId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM analytics_events a WHERE a.dedupe_key = 'CHECKOUT_ABANDONED:' || s.id
        )
      LIMIT 1`;
    if (open.length > 0) {
      return { recorded: false };
    }
    return {
      recorded: await insert(
        visitor,
        { eventType: "CHECKOUT_STARTED", entityType: "CART", entityId: cartId },
        now,
      ),
    };
  }

  /** After a successful `POST /cart/items`. */
  async function recordAddToCart(
    visitor: Visitor,
    input: { variantId: string; quantity: number },
  ): Promise<void> {
    const variant = await db.productVariant.findUniqueOrThrow({
      where: { id: input.variantId },
      select: { productId: true },
    });
    await insert(
      visitor,
      {
        eventType: "ADD_TO_CART",
        entityType: "PRODUCT",
        entityId: variant.productId,
        metadata: { variantId: input.variantId, quantity: input.quantity },
      },
      clock.now(),
    );
  }

  /** After a successful `POST /checkout`; an idempotent replay records nothing. */
  async function recordOrderCreated(visitor: Visitor, orderId: string): Promise<void> {
    await insert(
      visitor,
      {
        eventType: "ORDER_CREATED",
        entityType: "ORDER",
        entityId: orderId,
        dedupeKey: `ORDER_CREATED:${orderId}`,
      },
      clock.now(),
    );
  }

  /**
   * Job: records `CHECKOUT_ABANDONED` for each checkout start older than
   * `CHECKOUT_ABANDONMENT_MS` whose cart did not become an order (R35: the
   * cart itself is not marked). Safe to run again: one per start.
   */
  async function recordCheckoutAbandonments(): Promise<number> {
    const now = clock.now();
    const cutoff = new Date(now.getTime() - CHECKOUT_ABANDONMENT_MS);
    let total = 0;
    for (;;) {
      const starts = await db.$queryRaw<
        { id: string; anonymous_id: string | null; customer_id: string | null; entity_id: string }[]
      >`
        SELECT s.id, s.anonymous_id, s.customer_id, s.entity_id FROM analytics_events s
        LEFT JOIN carts c ON c.id = s.entity_id
        WHERE s.event_type = 'CHECKOUT_STARTED' AND s.occurred_at <= ${cutoff}::timestamptz
          AND (c.id IS NULL OR c.status <> 'CONVERTED')
          AND NOT EXISTS (
            SELECT 1 FROM analytics_events a WHERE a.dedupe_key = 'CHECKOUT_ABANDONED:' || s.id
          )
        ORDER BY s.occurred_at
        LIMIT ${ABANDONMENT_BATCH}`;
      if (starts.length === 0) {
        return total;
      }
      const { count } = await db.analyticsEvent.createMany({
        data: starts.map((s) => ({
          anonymousId: s.anonymous_id,
          customerId: s.customer_id,
          eventType: "CHECKOUT_ABANDONED" as const,
          entityType: "CART",
          entityId: s.entity_id,
          metadata: { checkoutStartedEventId: s.id },
          dedupeKey: `CHECKOUT_ABANDONED:${s.id}`,
          occurredAt: now,
        })),
        skipDuplicates: true,
      });
      total += count;
    }
  }

  return { trackClientEvent, recordAddToCart, recordOrderCreated, recordCheckoutAbandonments };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;

let defaultService: AnalyticsService | undefined;

export function getAnalyticsService(): AnalyticsService {
  defaultService ??= createAnalyticsService({ db: getDb(), clock: systemClock });
  return defaultService;
}

/**
 * Runs a server-side analytics write after the business write committed.
 * A failure is logged and swallowed: analytics never fails the request.
 */
export async function trackSafely(logger: Logger, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    logger.warn("Analytics event not recorded", { err: error });
  }
}
