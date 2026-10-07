import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listStaffNotifications } from "@/app/api/v1/admin/me/notifications/route";
import { POST as readStaffNotification } from "@/app/api/v1/admin/me/notifications/[id]/read/route";
import { GET as listDeliveries } from "@/app/api/v1/admin/notifications/deliveries/route";
import { POST as readNotification } from "@/app/api/v1/me/notifications/[notificationId]/read/route";
import { POST as readAll } from "@/app/api/v1/me/notifications/read-all/route";
import { GET as listNotifications } from "@/app/api/v1/me/notifications/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { EmailMessage } from "@/server/email/email";
import { hashToken } from "@/server/modules/auth/tokens";
import { createSession } from "@/server/modules/auth/sessions";
import {
  createNotification,
  createNotificationsService,
  DISPATCH_MAX_ATTEMPTS,
  DISPATCH_RETRY_STEP_MS,
} from "@/server/modules/notifications/notifications-service";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import type { WhatsAppMessage } from "@/server/whatsapp/whatsapp";
import { resetDatabase } from "@/test/integration/database";
import { bareOrder } from "@/test/integration/orders";

/** Notification centre, dispatch with fallback, delivery log (TASK-045, ADR-0043). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: { method?: string; token?: string; params?: Record<string, string> } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  return (handler as Handler)(
    new Request(`${BASE}${path}`, { method: options.method ?? "GET", headers }),
    {
      params: Promise.resolve(options.params ?? {}) as Promise<never>,
    },
  );
}

async function body(res: Response, status = 200) {
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json;
}

let counter = 0;

async function customer(options: { emailVerified?: boolean } = {}) {
  counter += 1;
  const now = new Date();
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: `n${counter}@example.com`,
      emailVerifiedAt: options.emailVerified === false ? null : now,
      passwordHash: "unused",
      status: "ACTIVE",
      customer: {
        create: {
          phone: `+2011${10000000 + counter}`,
          phoneVerifiedAt: now,
          fullName: "Sara Ali",
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

async function staff(level: EmployeeLevel, codes: PermissionCode[] = []) {
  counter += 1;
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `staff${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: {
        create: {
          displayName: `Staff ${counter}`,
          employeeLevel: level,
          roles: {
            create: [
              {
                role: {
                  create: {
                    name: `Role ${counter}`,
                    permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
                  },
                },
              },
            ],
          },
        },
      },
    },
    include: { employee: true },
  });
  const created = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return { employeeId: account.employee!.id, token: created.tokens.accessToken };
}

function event(orderId: string, eventType: string, at = new Date()) {
  return db.outboxEvent.create({
    data: {
      eventType,
      aggregateType: "ORDER",
      aggregateId: orderId,
      payload: { orderId },
      availableAt: at,
      createdAt: at,
    },
  });
}

/** Fake transports: record messages, or fail while `down`. */
function harness() {
  let now = new Date();
  const sent = { whatsapp: [] as WhatsAppMessage[], email: [] as EmailMessage[] };
  const down = { whatsapp: false, email: false };
  const service = createNotificationsService({
    db,
    clock: { now: () => now },
    websiteUrl: () => "https://shop.test",
    whatsapp: {
      async send(message) {
        if (down.whatsapp) throw new Error("provider unavailable");
        sent.whatsapp.push(message);
        return { reference: `wa-${sent.whatsapp.length}` };
      },
    },
    email: {
      async send(message) {
        if (down.email) throw new Error("smtp unavailable");
        sent.email.push(message);
      },
    },
  });
  return {
    service,
    sent,
    down,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

function deliveriesOf(orderId: string) {
  return db.notificationDelivery.findMany({
    where: { orderId },
    orderBy: { attemptNumber: "asc" },
  });
}

beforeAll(resetDatabase);
beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

describe("dispatch", () => {
  it("sends on WhatsApp, adds the in-app notification, and never sends twice", async () => {
    const c = await customer();
    const orderId = await bareOrder(c.id);
    const ev = await event(orderId, "ORDER_CREATED");
    const h = harness();

    expect(await h.service.dispatchPending()).toEqual({ done: 1, retried: 0, failed: 0 });
    expect(h.sent.whatsapp).toHaveLength(1);
    expect(h.sent.whatsapp[0].to).toBe(c.phone);
    expect(h.sent.email).toHaveLength(0);
    const [delivery] = await deliveriesOf(orderId);
    expect(delivery).toMatchObject({
      channel: "WHATSAPP",
      status: "SENT",
      attemptNumber: 1,
      providerReference: "wa-1",
      templateKey: "ORDER_CREATED",
      sourceEventId: ev.id,
    });
    const notification = await db.notification.findUniqueOrThrow({
      where: { sourceEventId: ev.id },
    });
    expect(notification).toMatchObject({
      customerId: c.id,
      type: "TRANSACTIONAL",
      deepLinkType: "ORDER",
      deepLinkId: orderId,
    });
    expect(delivery.notificationId).toBe(notification.id);
    expect(await db.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({
      status: "DONE",
    });

    // A crashed run that left the event claimed: the message is not sent again.
    await db.outboxEvent.update({
      where: { id: ev.id },
      data: { status: "PROCESSING", availableAt: new Date(0) },
    });
    expect(await h.service.dispatchPending()).toEqual({ done: 1, retried: 0, failed: 0 });
    expect(h.sent.whatsapp).toHaveLength(1);
    expect(await db.notification.count()).toBe(1);
  });

  it("falls back to the verified email when WhatsApp fails (Q55, Q56, Q61)", async () => {
    const c = await customer();
    const orderId = await bareOrder(c.id);
    await event(orderId, "ORDER_EXPIRED");
    const h = harness();
    h.down.whatsapp = true;

    expect(await h.service.dispatchPending()).toEqual({ done: 1, retried: 0, failed: 0 });
    expect(h.sent.email).toEqual([
      expect.objectContaining({ to: c.email, subject: "Order expired" }),
    ]);
    expect(
      (await deliveriesOf(orderId)).map((d) => [d.attemptNumber, d.channel, d.status]),
    ).toEqual([
      [1, "WHATSAPP", "FAILED"],
      [2, "EMAIL", "FALLBACK_SENT"],
    ]);
    expect((await deliveriesOf(orderId))[0].failureReason).toBe("provider unavailable");
  });

  it("does not fall back to an unverified email; retries, then gives up", async () => {
    const c = await customer({ emailVerified: false });
    const orderId = await bareOrder(c.id);
    const ev = await event(orderId, "ORDER_CREATED");
    const h = harness();
    h.down.whatsapp = true;

    expect(await h.service.dispatchPending()).toEqual({ done: 0, retried: 1, failed: 0 });
    expect(h.sent.email).toHaveLength(0);
    const pending = await db.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(pending).toMatchObject({ status: "PENDING", attemptCount: 1 });
    // Not due before the backoff.
    expect(await h.service.dispatchPending()).toEqual({ done: 0, retried: 0, failed: 0 });

    for (let attempt = 2; attempt <= DISPATCH_MAX_ATTEMPTS; attempt += 1) {
      h.advance(attempt * DISPATCH_RETRY_STEP_MS);
      await h.service.dispatchPending();
    }
    expect(await db.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({
      status: "FAILED",
      attemptCount: DISPATCH_MAX_ATTEMPTS,
    });
    const attempts = await deliveriesOf(orderId);
    expect(attempts).toHaveLength(DISPATCH_MAX_ATTEMPTS);
    expect(attempts.every((d) => d.channel === "WHATSAPP" && d.status === "FAILED")).toBe(true);
    // The in-app notification exists once, whatever the external channels did.
    expect(await db.notification.count({ where: { customerId: c.id } })).toBe(1);
  });

  it("sends a guest the COD link on WhatsApp only, with a working token (R10, R39)", async () => {
    const now = new Date();
    const { id: orderId } = await db.order.create({
      data: {
        orderNumber: `BF-G-${now.getTime()}`,
        guestPhone: "+201000000009",
        guestEmail: "guest@example.com",
        status: "PENDING_CONFIRMATION",
        locale: "en",
        subtotal: BigInt(10000),
        discountTotal: BigInt(0),
        shippingFee: BigInt(0),
        total: BigInt(10000),
        walletAmountReserved: BigInt(0),
        codAmount: BigInt(10000),
        shippingRuleSnapshot: {},
        shippingAddressSnapshot: {},
        customerSnapshot: { fullName: "Guest", phone: "+201000000009" },
        codConfirmationDeadlineAt: new Date(now.getTime() + 72 * MS_PER_HOUR),
        createdAt: now,
        updatedAt: now,
      },
    });
    await event(orderId, "COD_CONFIRMATION_REQUESTED");
    const h = harness();

    await h.service.dispatchPending();
    expect(h.sent.whatsapp).toHaveLength(1);
    const match = /https:\/\/shop\.test\/orders\/([^/]+)\/confirm-cod#token=(bfo_\S+)/.exec(
      h.sent.whatsapp[0].text,
    );
    expect(match?.[1]).toBe(orderId);
    expect(
      await db.codConfirmationToken.count({ where: { orderId, tokenHash: hashToken(match![2]) } }),
    ).toBe(1);
    expect(await db.notification.count()).toBe(0); // Guests have no in-app centre.

    // A reminder while WhatsApp is down: no email fallback for the link.
    await event(orderId, "COD_CONFIRMATION_REMINDER");
    h.down.whatsapp = true;
    h.advance(MS_PER_HOUR);
    expect(await h.service.dispatchPending()).toEqual({ done: 0, retried: 1, failed: 0 });
    expect(h.sent.email).toHaveLength(0);
    // The stored attempt never holds the message or the token.
    const logged = JSON.stringify(await deliveriesOf(orderId));
    expect(logged).not.toContain("bfo_");
  });

  it("skips the COD request of an order that is no longer pending", async () => {
    const orderId = await bareOrder();
    await db.order.update({ where: { id: orderId }, data: { status: "EXPIRED" } });
    const ev = await event(orderId, "COD_CONFIRMATION_REMINDER");
    const h = harness();

    expect(await h.service.dispatchPending()).toEqual({ done: 1, retried: 0, failed: 0 });
    expect(h.sent.whatsapp).toHaveLength(0);
    expect(await deliveriesOf(orderId)).toHaveLength(0);
    expect(await db.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({
      status: "DONE",
    });
  });

  it("leaves events it does not handle alone", async () => {
    const orderId = await bareOrder();
    const ev = await event(orderId, "PURCHASE_RECEIVED");
    await harness().service.dispatchPending();
    expect(await db.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({
      status: "PENDING",
      attemptCount: 0,
    });
  });
});

describe("customer notification centre (Q58)", () => {
  it("lists, filters unread, marks one and all as read; others' are 404", async () => {
    const c = await customer();
    const other = await customer();
    const now = new Date();
    const first = await createNotification(db, {
      customerId: c.id,
      type: "TRANSACTIONAL",
      title: "One",
      body: "First",
      now: new Date(now.getTime() - 1000),
    });
    await createNotification(db, {
      customerId: c.id,
      type: "TRANSACTIONAL",
      title: "Two",
      body: "Second",
      deepLink: { type: "ORDER", id: UNKNOWN_ID },
      now,
    });
    const foreign = await createNotification(db, {
      customerId: other.id,
      type: "TRANSACTIONAL",
      title: "Other",
      body: "x",
      now,
    });

    const all = await body(await call(listNotifications, "/me/notifications", { token: c.token }));
    expect(all.data.map((n: { title: string }) => n.title)).toEqual(["Two", "One"]);
    expect(all.data[0].deepLink).toEqual({ type: "ORDER", id: UNKNOWN_ID });
    expect(all.meta.pagination.total).toBe(2);

    const read = await body(
      await call(readNotification, `/me/notifications/${first}/read`, {
        method: "POST",
        token: c.token,
        params: { notificationId: first },
      }),
    );
    expect(read.data.readAt).not.toBeNull();
    const again = await body(
      await call(readNotification, `/me/notifications/${first}/read`, {
        method: "POST",
        token: c.token,
        params: { notificationId: first },
      }),
    );
    expect(again.data.readAt).toBe(read.data.readAt);

    const unread = await body(
      await call(listNotifications, "/me/notifications?unread=true", { token: c.token }),
    );
    expect(unread.data.map((n: { title: string }) => n.title)).toEqual(["Two"]);

    for (const id of [foreign, UNKNOWN_ID, "not-a-uuid"]) {
      const res = await call(readNotification, `/me/notifications/${id}/read`, {
        method: "POST",
        token: c.token,
        params: { notificationId: id },
      });
      expect((await body(res, 404)).error.code).toBe("NOT_FOUND");
    }

    const all2 = await body(
      await call(readAll, "/me/notifications/read-all", { method: "POST", token: c.token }),
    );
    expect(all2.data).toEqual({ updated: 1 });
    expect(await db.notification.count({ where: { id: foreign, readAt: null } })).toBe(1);
  });

  it("needs a customer session", async () => {
    await body(await call(listNotifications, "/me/notifications"), 401);
    const employee = await staff("EMPLOYEE");
    await body(await call(listNotifications, "/me/notifications", { token: employee.token }), 403);
  });
});

describe("staff notifications and delivery log", () => {
  it("shows an employee only their own notifications", async () => {
    const a = await staff("EMPLOYEE");
    const b = await staff("EMPLOYEE");
    const mine = await createNotification(db, {
      employeeId: a.employeeId,
      type: "TRANSACTIONAL",
      title: "Low stock",
      body: "Variant X is low",
      now: new Date(),
    });
    const list = await body(
      await call(listStaffNotifications, "/admin/me/notifications", { token: a.token }),
    );
    expect(list.data).toHaveLength(1);
    const empty = await body(
      await call(listStaffNotifications, "/admin/me/notifications", { token: b.token }),
    );
    expect(empty.data).toHaveLength(0);
    await body(
      await call(readStaffNotification, `/admin/me/notifications/${mine}/read`, {
        method: "POST",
        token: b.token,
        params: { id: mine },
      }),
      404,
    );
    const read = await body(
      await call(readStaffNotification, `/admin/me/notifications/${mine}/read`, {
        method: "POST",
        token: a.token,
        params: { id: mine },
      }),
    );
    expect(read.data.readAt).not.toBeNull();
    const c = await customer();
    await body(
      await call(listStaffNotifications, "/admin/me/notifications", { token: c.token }),
      403,
    );
  });

  it("needs NOTIFICATION_LOG_VIEW; recipients need VIEW_CUSTOMER_CONTACT", async () => {
    const c = await customer();
    const orderId = await bareOrder(c.id);
    await event(orderId, "ORDER_CREATED");
    await harness().service.dispatchPending();

    const none = await staff("EMPLOYEE");
    const res = await call(listDeliveries, "/admin/notifications/deliveries", {
      token: none.token,
    });
    expect((await body(res, 403)).error.code).toBe("PERMISSION_DENIED");

    const viewer = await staff("EMPLOYEE", ["NOTIFICATION_LOG_VIEW"]);
    const masked = await body(
      await call(listDeliveries, `/admin/notifications/deliveries?orderId=${orderId}`, {
        token: viewer.token,
      }),
    );
    expect(masked.data).toHaveLength(1);
    expect(masked.data[0]).toMatchObject({ channel: "WHATSAPP", status: "SENT" });
    expect(masked.data[0].recipient).toBeUndefined();

    const contact = await staff("EMPLOYEE", ["NOTIFICATION_LOG_VIEW", "VIEW_CUSTOMER_CONTACT"]);
    const full = await body(
      await call(listDeliveries, "/admin/notifications/deliveries?status=SENT&channel=WHATSAPP", {
        token: contact.token,
      }),
    );
    expect(full.data[0].recipient).toBe(c.phone);
  });
});
