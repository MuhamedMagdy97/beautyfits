import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as track } from "@/app/api/v1/analytics/events/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { getDb } from "@/server/db/client";
import {
  ANALYTICS_IP_LIMIT,
  CHECKOUT_ABANDONMENT_MS,
  createAnalyticsService,
  isLikelyBot,
} from "@/server/modules/analytics/analytics-service";
import { createSession } from "@/server/modules/auth/sessions";
import { MS_PER_DAY, MS_PER_MINUTE, fixedClock } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Analytics event collection (TASK-050, Q145–Q148, ADR-0044). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const ANON = "0192f000-0000-7000-8000-000000000001";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    token?: string;
    guest?: string;
    anon?: string | null;
    ua?: string;
    key?: string;
    body?: unknown;
  } = {},
): Promise<Response> {
  const headers = new Headers({
    "accept-language": "en",
    "content-type": "application/json",
    "user-agent": options.ua ?? BROWSER,
  });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.guest) headers.set("x-guest-cart-token", options.guest);
  if (options.anon !== null) headers.set("x-anonymous-id", options.anon ?? ANON);
  if (options.key) headers.set("idempotency-key", `checkout-${options.key}`);
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body ?? {}),
    }),
    { params: Promise.resolve({}) as Promise<never> },
  );
}

async function data(res: Response, status: number) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data ?? body.error;
}

let counter = 0;
let areaId: string;

async function product(status: "PUBLISHED" | "DRAFT" = "PUBLISHED") {
  counter += 1;
  const created = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      status,
      firstPublishedAt: status === "PUBLISHED" ? new Date() : null,
      variants: {
        create: [{ sku: `SKU-${counter}`, isDefault: true, sellingPrice: BigInt(15000) }],
      },
    },
    include: { variants: true },
  });
  const variantId = created.variants[0].id;
  await db.inventoryMovement.create({
    data: {
      productVariantId: variantId,
      movementType: "MANUAL_ADJUSTMENT",
      availableDelta: 10,
      reason: "Test stock",
      createdByType: "SYSTEM",
    },
  });
  return { productId: created.id, variantId };
}

async function customer() {
  counter += 1;
  const now = new Date();
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: `c${counter}@example.com`,
      emailVerifiedAt: now,
      passwordHash: "unused",
      status: "ACTIVE",
      customer: {
        create: { phone: `+2010${10000000 + counter}`, phoneVerifiedAt: now, fullName: "Sara" },
      },
    },
    include: { customer: true },
  });
  const session = await createSession(
    db,
    { accountId: account.id, domain: "CUSTOMER", ttlMs: 30 * MS_PER_DAY },
    { ip: null, userAgent: null },
    now,
  );
  return { customerId: account.customer!.id, token: session.tokens.accessToken };
}

async function addToCart(variantId: string, who: { guest?: string; token?: string } = {}) {
  const cart = await data(
    await call(addItem, "/cart/items", { ...who, body: { variantId, quantity: 2 } }),
    200,
  );
  return (cart.guestCartToken as string | undefined) ?? who.guest;
}

beforeEach(async () => {
  await resetDatabase();
  const cairo = await db.governorate.findUniqueOrThrow({ where: { code: "C" } });
  areaId = (
    await db.area.create({ data: { governorateId: cairo.id, nameAr: "المعادي", nameEn: "Maadi" } })
  ).id;
  await db.shippingRule.create({ data: { shippingFee: BigInt(5000) } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("isLikelyBot", () => {
  it("flags crawlers and missing user agents, not browsers", () => {
    expect(isLikelyBot(BROWSER)).toBe(false);
    expect(isLikelyBot("Googlebot/2.1")).toBe(true);
    expect(isLikelyBot("HeadlessChrome/120")).toBe(true);
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot(" ")).toBe(true);
  });
});

describe("POST /analytics/events — PRODUCT_VIEW", () => {
  it("records a guest view once per refresh window, with no personal data", async () => {
    const { productId } = await product();
    const body = { eventType: "PRODUCT_VIEW", productId };
    expect(await data(await call(track, "/analytics/events", { body }), 202)).toEqual({
      recorded: true,
    });
    expect(await data(await call(track, "/analytics/events", { body }), 202)).toEqual({
      recorded: false,
    });
    // Another visitor counts.
    const other = "0192f000-0000-7000-8000-000000000002";
    expect(await data(await call(track, "/analytics/events", { body, anon: other }), 202)).toEqual({
      recorded: true,
    });
    const rows = await db.analyticsEvent.findMany({ orderBy: { occurredAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      eventType: "PRODUCT_VIEW",
      entityType: "PRODUCT",
      entityId: productId,
      anonymousId: ANON,
      customerId: null,
      metadata: {},
    });
  });

  it("counts again after the refresh window", async () => {
    const { productId } = await product();
    const start = new Date("2026-10-07T10:00:00Z");
    const visitor = { customerId: null, anonymousId: ANON };
    const req = { ip: null, userAgent: BROWSER };
    const input = { eventType: "PRODUCT_VIEW" as const, productId };
    const owner = { kind: "guest" as const, token: null };
    const at = (t: Date) => createAnalyticsService({ db, clock: fixedClock(t) });
    expect(await at(start).trackClientEvent(owner, visitor, input, req)).toEqual({
      recorded: true,
    });
    const later = new Date(start.getTime() + 31 * MS_PER_MINUTE);
    expect(await at(later).trackClientEvent(owner, visitor, input, req)).toEqual({
      recorded: true,
    });
  });

  it("links a signed-in customer and ignores bots and unpublished products", async () => {
    const { productId } = await product();
    const draft = await product("DRAFT");
    const { customerId, token } = await customer();
    expect(
      await data(
        await call(track, "/analytics/events", {
          token,
          anon: null,
          body: { eventType: "PRODUCT_VIEW", productId },
        }),
        202,
      ),
    ).toEqual({ recorded: true });
    for (const options of [
      { ua: "Googlebot/2.1", body: { eventType: "PRODUCT_VIEW", productId } },
      { body: { eventType: "PRODUCT_VIEW", productId: draft.productId } },
    ]) {
      expect(await data(await call(track, "/analytics/events", options), 202)).toEqual({
        recorded: false,
      });
    }
    expect(await db.analyticsEvent.findMany()).toMatchObject([{ customerId, anonymousId: null }]);
  });

  it("validates the input and the visitor id", async () => {
    const { productId } = await product();
    expect(
      await data(
        await call(track, "/analytics/events", { body: { eventType: "ADD_TO_CART" } }),
        400,
      ),
    ).toMatchObject({ code: "VALIDATION_ERROR" });
    for (const anon of [null, "not-a-uuid"]) {
      expect(
        await data(
          await call(track, "/analytics/events", {
            anon,
            body: { eventType: "PRODUCT_VIEW", productId },
          }),
          400,
        ),
      ).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(
      await data(
        await call(track, "/analytics/events", {
          token: "bfa_bad",
          body: { eventType: "PRODUCT_VIEW", productId },
        }),
        401,
      ),
    ).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("is rate limited per IP", async () => {
    const { productId } = await product();
    const now = new Date();
    await db.rateLimitBucket.create({
      data: {
        key: "analytics:ip:unknown",
        count: ANALYTICS_IP_LIMIT.limit,
        windowStartedAt: now,
        blockedUntil: new Date(now.getTime() + ANALYTICS_IP_LIMIT.blockMs),
        updatedAt: now,
      },
    });
    expect(
      await data(
        await call(track, "/analytics/events", { body: { eventType: "PRODUCT_VIEW", productId } }),
        429,
      ),
    ).toMatchObject({ code: "RATE_LIMITED", details: { retryAfterSeconds: expect.any(Number) } });
  });
});

describe("server-recorded funnel events", () => {
  it("records add to cart, checkout start, the order once, and no abandonment", async () => {
    const { productId, variantId } = await product();
    const guest = await addToCart(variantId);
    expect(
      await db.analyticsEvent.findFirst({ where: { eventType: "ADD_TO_CART" } }),
    ).toMatchObject({
      entityType: "PRODUCT",
      entityId: productId,
      anonymousId: ANON,
      metadata: { variantId, quantity: 2 },
    });

    const start = { guest, body: { eventType: "CHECKOUT_STARTED" } };
    expect(await data(await call(track, "/analytics/events", start), 202)).toEqual({
      recorded: true,
    });
    // One open start per cart.
    expect(await data(await call(track, "/analytics/events", start), 202)).toEqual({
      recorded: false,
    });
    const cart = await db.cart.findFirstOrThrow();
    expect(
      await db.analyticsEvent.findFirst({ where: { eventType: "CHECKOUT_STARTED" } }),
    ).toMatchObject({ entityType: "CART", entityId: cart.id });

    const body = {
      contact: { fullName: "Mona Adel", phone: "01012345678" },
      address: { recipientName: "Mona", phone: "01012345678", areaId, street: "9 Road 9" },
      expectedTotal: 35000,
    };
    const order = await data(await call(checkout, "/checkout", { guest, key: "a", body }), 201);
    // An idempotent replay records nothing more.
    await data(await call(checkout, "/checkout", { guest, key: "a", body }), 201);
    expect(
      await db.analyticsEvent.findMany({ where: { eventType: "ORDER_CREATED" } }),
    ).toMatchObject([{ entityType: "ORDER", entityId: order.id, anonymousId: ANON }]);

    const job = createAnalyticsService({
      db,
      clock: fixedClock(new Date(Date.now() + CHECKOUT_ABANDONMENT_MS + MS_PER_MINUTE)),
    });
    expect(await job.recordCheckoutAbandonments()).toBe(0);
  });

  it("does not record checkout start without a non-empty cart", async () => {
    expect(
      await data(
        await call(track, "/analytics/events", { body: { eventType: "CHECKOUT_STARTED" } }),
        202,
      ),
    ).toEqual({ recorded: false });
  });

  it("records an abandonment once per start, after the threshold, then allows a new start", async () => {
    const { variantId } = await product();
    const { customerId, token } = await customer();
    await addToCart(variantId, { token });
    const t0 = new Date();
    const at = (ms: number) =>
      createAnalyticsService({ db, clock: fixedClock(new Date(t0.getTime() + ms)) });
    const owner = { kind: "customer" as const, customerId };
    const visitor = { customerId, anonymousId: null };
    const req = { ip: null, userAgent: BROWSER };
    const input = { eventType: "CHECKOUT_STARTED" as const };
    expect(await at(0).trackClientEvent(owner, visitor, input, req)).toEqual({ recorded: true });

    expect(await at(CHECKOUT_ABANDONMENT_MS - MS_PER_MINUTE).recordCheckoutAbandonments()).toBe(0);
    expect(await at(CHECKOUT_ABANDONMENT_MS).recordCheckoutAbandonments()).toBe(1);
    expect(await at(CHECKOUT_ABANDONMENT_MS * 2).recordCheckoutAbandonments()).toBe(0);
    const started = await db.analyticsEvent.findFirstOrThrow({
      where: { eventType: "CHECKOUT_STARTED" },
    });
    expect(
      await db.analyticsEvent.findFirst({ where: { eventType: "CHECKOUT_ABANDONED" } }),
    ).toMatchObject({
      customerId,
      entityType: "CART",
      entityId: started.entityId,
      metadata: { checkoutStartedEventId: started.id },
    });
    // The cart is not marked (R35).
    expect((await db.cart.findFirstOrThrow()).status).toBe("ACTIVE");

    expect(
      await at(CHECKOUT_ABANDONMENT_MS + MS_PER_MINUTE).trackClientEvent(
        owner,
        visitor,
        input,
        req,
      ),
    ).toEqual({ recorded: true });
  });

  it("never fails the business request when analytics cannot record", async () => {
    const { variantId } = await product();
    await db.$executeRawUnsafe(
      "ALTER TABLE analytics_events ADD CONSTRAINT t050_block CHECK (event_type <> 'ADD_TO_CART')",
    );
    try {
      await addToCart(variantId);
      expect(await db.cartItem.count()).toBe(1);
    } finally {
      await db.$executeRawUnsafe("ALTER TABLE analytics_events DROP CONSTRAINT t050_block");
    }
  });
});
