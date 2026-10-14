import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DELETE as unsubscribe,
  GET as getSubscription,
  POST as subscribe,
} from "@/app/api/v1/variants/[variantId]/restock-subscription/route";
import type { NotificationChannel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { EmailMessage } from "@/server/email/email";
import { createSession } from "@/server/modules/auth/sessions";
import { createNotificationsService } from "@/server/modules/notifications/notifications-service";
import { createRestockService } from "@/server/modules/restock/restock-service";
import {
  createWishlistRemindersService,
  REMINDER_INTERVAL_MS,
} from "@/server/modules/wishlist/reminders";
import { MS_PER_DAY } from "@/server/time/time";
import type { WhatsAppMessage } from "@/server/whatsapp/whatsapp";
import { resetDatabase } from "@/test/integration/database";
import { bareOrder } from "@/test/integration/orders";

/** Restock Notify Me and wishlist purchase reminders (TASK-043, ADR-0050, Q51, Q52, R6, R12). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  variantId: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return (handler as Handler)(
    new Request(`${BASE}/variants/${variantId}/restock-subscription`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve({ variantId }) as Promise<never> },
  );
}

async function data(res: Response, status = 200) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data;
}

async function errorOf(res: Response, status: number) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.error;
}

let counter = 0;

async function addStock(variantId: string, quantity: number) {
  await db.inventoryMovement.create({
    data: {
      productVariantId: variantId,
      movementType: "MANUAL_ADJUSTMENT",
      availableDelta: quantity,
      reason: "Test stock",
      createdByType: "SYSTEM",
    },
  });
}

/** A published product with one priced variant holding `stock` units. */
async function variant(stock = 0, price: bigint | null = BigInt(15000)): Promise<string> {
  counter += 1;
  const created = await db.product.create({
    data: {
      nameAr: "زيت الورد",
      nameEn: `Rose Oil ${counter}`,
      slug: `rose-oil-${counter}`,
      status: "PUBLISHED",
      firstPublishedAt: new Date(),
      variants: {
        create: [{ sku: `RS-${counter}`, isDefault: true, sellingPrice: price }],
      },
    },
    include: { variants: true },
  });
  const id = created.variants[0].id;
  if (stock > 0) await addStock(id, stock);
  return id;
}

async function customer() {
  counter += 1;
  const now = new Date();
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: `r${counter}@example.com`,
      emailVerifiedAt: now,
      passwordHash: "unused",
      status: "ACTIVE",
      customer: {
        create: {
          phone: `+2012${10000000 + counter}`,
          phoneVerifiedAt: now,
          fullName: "Sara",
          preferredLocale: "en",
        },
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
  return {
    id: account.customer!.id,
    phone: account.customer!.phone,
    email: account.email,
    token: session.tokens.accessToken,
  };
}

function post(token: string, variantId: string, channels: unknown) {
  return call(subscribe, variantId, { method: "POST", token, body: { channels } });
}

/** Records messages; `consent` stands in for the TASK-046 ledger. */
function harness(start = new Date()) {
  let now = start;
  const clock = { now: () => now };
  const consent = new Map<string, NotificationChannel[]>();
  const marketingConsent = (_db: unknown, customerId: string) =>
    Promise.resolve(consent.get(customerId) ?? []);
  const sent = { whatsapp: [] as WhatsAppMessage[], email: [] as EmailMessage[] };
  const notifications = createNotificationsService({
    db,
    clock,
    websiteUrl: () => "https://shop.test",
    marketingConsent,
    whatsapp: {
      async send(message) {
        sent.whatsapp.push(message);
        return { reference: `wa-${sent.whatsapp.length}` };
      },
    },
    email: {
      async send(message) {
        sent.email.push(message);
      },
    },
  });
  return {
    sent,
    consent,
    notifications,
    restock: createRestockService({ db, clock }),
    reminders: createWishlistRemindersService({ db, clock, marketingConsent }),
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function wishlistItem(customerId: string, variantId: string): Promise<string> {
  const wishlist = await db.wishlist.create({ data: { customerId } });
  const item = await db.wishlistItem.create({
    data: { wishlistId: wishlist.id, productVariantId: variantId },
  });
  return item.id;
}

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

describe("restock subscription endpoints (R12)", () => {
  it("needs a signed-in customer", async () => {
    const v = await variant();
    await errorOf(await call(getSubscription, v), 401);
    await errorOf(await call(subscribe, v, { method: "POST", body: { channels: ["EMAIL"] } }), 401);
  });

  it("subscribes, changes channels, reads and cancels", async () => {
    const c = await customer();
    const v = await variant();

    expect(await data(await call(getSubscription, v, { token: c.token }))).toEqual({
      subscription: null,
    });
    const first = (await data(await post(c.token, v, ["WHATSAPP", "EMAIL"]))).subscription;
    expect(first).toMatchObject({
      variantId: v,
      channels: ["WHATSAPP", "EMAIL"],
      status: "ACTIVE",
    });

    const second = (await data(await post(c.token, v, ["EMAIL"]))).subscription;
    expect(second).toMatchObject({ id: first.id, channels: ["EMAIL"] });
    expect((await data(await call(getSubscription, v, { token: c.token }))).subscription.id).toBe(
      first.id,
    );

    const del = () => call(unsubscribe, v, { method: "DELETE", token: c.token });
    expect(await data(await del())).toEqual({ subscription: null });
    expect(await data(await del())).toEqual({ subscription: null });
    const row = await db.restockSubscription.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelledAt).not.toBeNull();
  });

  it("validates channels and the variant", async () => {
    const c = await customer();
    const v = await variant();
    expect((await errorOf(await post(c.token, v, []), 400)).code).toBe("VALIDATION_ERROR");
    expect((await errorOf(await post(c.token, v, ["SMS"]), 400)).code).toBe("VALIDATION_ERROR");
    await errorOf(await post(c.token, v, ["EMAIL", "EMAIL"]), 400);
    await errorOf(await post(c.token, UNKNOWN_ID, ["EMAIL"]), 404);
    await errorOf(await post(c.token, "not-a-uuid", ["EMAIL"]), 404);

    const inStock = await variant(5);
    const error = await errorOf(await post(c.token, inStock, ["EMAIL"]), 409);
    expect(error.details.reason).toBe("VARIANT_IN_STOCK");

    await db.product.updateMany({
      where: { variants: { some: { id: v } } },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await errorOf(await post(c.token, v, ["EMAIL"]), 404);
  });
});

describe("restock notification (Q51, Q52)", () => {
  it("sends one message per subscription on its chosen channels, then closes it", async () => {
    const a = await customer();
    const b = await customer();
    const v = await variant();
    const other = await variant();
    await data(await post(a.token, v, ["WHATSAPP"]));
    await data(await post(b.token, v, ["EMAIL"]));
    await data(await post(a.token, other, ["EMAIL"]));
    const h = harness();

    expect(await h.restock.notifyRestocked()).toEqual({ notified: 0 });
    await addStock(v, 3);
    expect(await h.restock.notifyRestocked()).toEqual({ notified: 2 });
    expect(await h.restock.notifyRestocked()).toEqual({ notified: 0 });

    const rows = await db.restockSubscription.findMany({ where: { productVariantId: v } });
    expect(rows.every((r) => r.status === "FULFILLED" && r.fulfilledAt)).toBe(true);
    expect(
      (await db.restockSubscription.findFirstOrThrow({ where: { productVariantId: other } }))
        .status,
    ).toBe("ACTIVE");

    expect(await h.notifications.dispatchPending()).toMatchObject({ done: 2 });
    expect(h.sent.whatsapp.map((m) => m.to)).toEqual([a.phone]);
    expect(h.sent.email.map((m) => m.to)).toEqual([b.email]);
    expect(h.sent.whatsapp[0].text).toContain("https://shop.test/products/");
    const inApp = await db.notification.findMany({ where: { type: "RESTOCK" } });
    expect(inApp.map((n) => n.customerId).sort()).toEqual([a.id, b.id].sort());
    expect(inApp[0].deepLinkType).toBe("PRODUCT");

    expect(await h.notifications.dispatchPending()).toEqual({ done: 0, retried: 0, failed: 0 });
    expect(h.sent.whatsapp).toHaveLength(1);

    // A new cycle needs a new subscription (Q52); while in stock there is nothing to subscribe to.
    await errorOf(await post(a.token, v, ["WHATSAPP"]), 409);
  });

  it("waits while the variant is not purchasable", async () => {
    const c = await customer();
    const v = await variant(0, null); // Not priced yet.
    await data(await post(c.token, v, ["EMAIL"]));
    await addStock(v, 2);
    const h = harness();
    expect(await h.restock.notifyRestocked()).toEqual({ notified: 0 });
  });
});

describe("wishlist purchase reminders (R6)", () => {
  async function setup(stock = 5) {
    const c = await customer();
    const v = await variant(stock);
    const itemId = await wishlistItem(c.id, v);
    const h = harness(new Date(Date.now() + REMINDER_INTERVAL_MS + 1000));
    return { c, v, itemId, h };
  }

  function item(id: string) {
    return db.wishlistItem.findUniqueOrThrow({ where: { id } });
  }

  it("sends nothing without marketing consent (TASK-046 seam default)", async () => {
    const { itemId, h } = await setup();
    expect(await h.reminders.sendDue()).toEqual({ sent: 0, stopped: 0 });
    expect(await item(itemId)).toMatchObject({ reminderCount: 0, remindersStoppedReason: null });
  });

  it("reminds every 3 days, at most 3 times, on consented channels only", async () => {
    const { c, itemId, h } = await setup();
    h.consent.set(c.id, ["EMAIL"]);

    expect(await h.reminders.sendDue()).toEqual({ sent: 1, stopped: 0 });
    expect(await h.reminders.sendDue()).toEqual({ sent: 0, stopped: 0 });
    h.advance(REMINDER_INTERVAL_MS - 1000);
    expect(await h.reminders.sendDue()).toEqual({ sent: 0, stopped: 0 });
    h.advance(1000);
    expect(await h.reminders.sendDue()).toEqual({ sent: 1, stopped: 0 });
    h.advance(REMINDER_INTERVAL_MS);
    expect(await h.reminders.sendDue()).toEqual({ sent: 1, stopped: 0 });
    h.advance(REMINDER_INTERVAL_MS);
    expect(await h.reminders.sendDue()).toEqual({ sent: 0, stopped: 0 });
    expect(await item(itemId)).toMatchObject({
      reminderCount: 3,
      remindersStoppedReason: "MAX_REMINDERS",
    });

    expect(await h.notifications.dispatchPending()).toMatchObject({ done: 3 });
    expect(h.sent.whatsapp).toHaveLength(0); // No WhatsApp marketing consent.
    expect(h.sent.email.map((m) => m.to)).toEqual([c.email, c.email, c.email]);
    expect(await db.notification.count()).toBe(0); // No in-app marketing copy.
  });

  it("stops when the item becomes unavailable", async () => {
    const { c, v, itemId, h } = await setup();
    h.consent.set(c.id, ["WHATSAPP"]);
    await db.product.updateMany({
      where: { variants: { some: { id: v } } },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    expect(await h.reminders.sendDue()).toEqual({ sent: 0, stopped: 1 });
    expect((await item(itemId)).remindersStoppedReason).toBe("UNAVAILABLE");
  });

  it("stops when the item is purchased, not counting cancelled orders", async () => {
    const { c, v, itemId, h } = await setup();
    h.consent.set(c.id, ["WHATSAPP"]);
    const product = await db.productVariant.findUniqueOrThrow({ where: { id: v } });
    const orderItem = async (status: "CANCELLED" | "NEW") => {
      const orderId = await bareOrder(c.id);
      await db.order.update({ where: { id: orderId }, data: { status } });
      await db.orderItem.create({
        data: {
          orderId,
          productId: product.productId,
          productVariantId: v,
          skuSnapshot: product.sku,
          productNameSnapshot: { en: "Rose Oil" },
          unitPrice: BigInt(15000),
          quantity: 1,
          discountAmount: BigInt(0),
          lineTotal: BigInt(15000),
          createdAt: new Date(),
        },
      });
    };
    await orderItem("CANCELLED");
    expect(await h.reminders.sendDue()).toEqual({ sent: 1, stopped: 0 });
    h.advance(REMINDER_INTERVAL_MS);
    await orderItem("NEW");
    expect(await h.reminders.sendDue()).toEqual({ sent: 0, stopped: 1 });
    expect((await item(itemId)).remindersStoppedReason).toBe("PURCHASED");
  });

  it("stops when consent is withdrawn after a reminder, and skips out-of-stock items", async () => {
    const { c, v, itemId, h } = await setup();
    h.consent.set(c.id, ["WHATSAPP"]);
    expect(await h.reminders.sendDue()).toEqual({ sent: 1, stopped: 0 });

    // Withdrawn before the queued reminder is sent: nothing goes out.
    h.consent.delete(c.id);
    expect(await h.notifications.dispatchPending()).toMatchObject({ done: 1 });
    expect(h.sent.whatsapp).toHaveLength(0);

    h.advance(REMINDER_INTERVAL_MS);
    await addStock(v, -5);
    h.consent.set(c.id, ["WHATSAPP"]);
    expect(await h.reminders.sendDue()).toEqual({ sent: 0, stopped: 0 });
    expect((await item(itemId)).reminderCount).toBe(1);

    h.consent.delete(c.id);
    await addStock(v, 1);
    expect(await h.reminders.sendDue()).toEqual({ sent: 0, stopped: 1 });
    expect((await item(itemId)).remindersStoppedReason).toBe("NO_MARKETING_CONSENT");
  });

  it("sends nothing for an item removed after its reminder was queued", async () => {
    const { c, itemId, h } = await setup();
    h.consent.set(c.id, ["WHATSAPP"]);
    expect(await h.reminders.sendDue()).toEqual({ sent: 1, stopped: 0 });
    await db.wishlistItem.delete({ where: { id: itemId } });
    expect(await h.notifications.dispatchPending()).toMatchObject({ done: 1 });
    expect(h.sent.whatsapp).toHaveLength(0);
  });
});
