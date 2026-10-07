import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as recordPhone } from "@/app/api/v1/admin/orders/[orderId]/record-phone-confirmation/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { POST as validate } from "@/app/api/v1/checkout/validate/route";
import { POST as confirmCod } from "@/app/api/v1/orders/[orderId]/confirm-cod/route";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logging/logger";
import { createSession } from "@/server/modules/auth/sessions";
import { createCodService, getCodService } from "@/server/modules/orders/cod-service";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { SETTING_KEYS } from "@/server/modules/settings/settings";
import { fixedClock, MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** COD confirmation, reminders and expiry (TASK-031, Q25, Q54, R1, R10, R16, R39). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";
const CTX = { logger, correlationId: null };

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    token?: string;
    guest?: string;
    key?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.guest) headers.set("x-guest-cart-token", options.guest);
  if (options.key) headers.set("idempotency-key", `checkout-${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) as Promise<never> },
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
let areaId: string;

async function variant() {
  counter += 1;
  const created = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      status: "PUBLISHED",
      firstPublishedAt: new Date(),
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
  return variantId;
}

async function customerToken() {
  counter += 1;
  const now = new Date();
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: `c${counter}@example.com`,
      emailVerifiedAt: now,
      passwordHash: "unused",
      status: "ACTIVE",
      customer: { create: { phone: `+2010${10000000 + counter}`, fullName: "Sara" } },
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

async function staff(codes: PermissionCode[]) {
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
          employeeLevel: "EMPLOYEE",
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

/** Places a COD order through checkout; a customer when `token` is given, else a guest. */
async function placeOrder(token?: string): Promise<{ id: string; orderNumber: string }> {
  counter += 1;
  const variantId = await variant();
  const added = await data(
    await call(addItem, "/cart/items", { token, body: { variantId, quantity: 2 } }),
  );
  const who = { token, guest: token ? undefined : (added.guestCartToken as string) };
  const address = { recipientName: "Mona", phone: "01012345678", areaId, street: "9 Road 9" };
  const body = token
    ? { address }
    : { contact: { fullName: "Guest", phone: "01198765432" }, address };
  const quote = await data(await call(validate, "/checkout/validate", { ...who, body }));
  return data(
    await call(checkout, "/checkout", {
      ...who,
      key: `o-${counter}`,
      body: { ...body, expectedTotal: quote.total },
    }),
    201,
  );
}

function setSetting(key: string, value: unknown, dataType: "INTEGER" | "STRING" = "INTEGER") {
  return db.setting.upsert({
    where: { key },
    create: { key, valueJson: value as never, dataType },
    update: { valueJson: value as never },
  });
}

/** The COD service seeing the clock `hours` after the order was created. */
async function after(orderId: string, hours: number) {
  const { createdAt } = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  return createCodService({
    db,
    clock: fixedClock(new Date(createdAt.getTime() + hours * MS_PER_HOUR)),
  });
}

function events(orderId: string, eventType: string) {
  return db.outboxEvent.findMany({ where: { aggregateId: orderId, eventType } });
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

describe("checkout", () => {
  it("fixes the deadline at 72 hours and requests WhatsApp confirmation by default", async () => {
    const placed = await placeOrder();
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order.status).toBe("PENDING_CONFIRMATION");
    expect(order.codConfirmationDeadlineAt!.getTime() - order.createdAt.getTime()).toBe(
      72 * MS_PER_HOUR,
    );
    expect(await events(placed.id, "COD_CONFIRMATION_REQUESTED")).toHaveLength(1);
  });

  it("uses the configured timeout and sends nothing on the phone channel", async () => {
    await setSetting(SETTING_KEYS.codConfirmationTimeoutHours, 24);
    await setSetting(SETTING_KEYS.codConfirmationChannel, "PHONE", "STRING");
    const placed = await placeOrder();
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order.codConfirmationDeadlineAt!.getTime() - order.createdAt.getTime()).toBe(
      24 * MS_PER_HOUR,
    );
    expect(await events(placed.id, "COD_CONFIRMATION_REQUESTED")).toHaveLength(0);

    // A later change of the timeout does not move an existing deadline (R39).
    await setSetting(SETTING_KEYS.codConfirmationTimeoutHours, 72);
    expect(await (await after(placed.id, 25)).expireOrders()).toBe(1);
  });

  it("falls back to 72 hours when the stored timeout is above the maximum", async () => {
    await setSetting(SETTING_KEYS.codConfirmationTimeoutHours, 100);
    const placed = await placeOrder();
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order.codConfirmationDeadlineAt!.getTime() - order.createdAt.getTime()).toBe(
      72 * MS_PER_HOUR,
    );
  });
});

describe("POST /orders/{orderId}/confirm-cod", () => {
  it("confirms through the secure link; the System moves the order to NEW", async () => {
    const sara = await customerToken();
    const placed = await placeOrder(sara.token);
    const { token, expiresAt } = await getCodService().issueConfirmationToken(placed.id);
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(expiresAt).toEqual(order.codConfirmationDeadlineAt);

    const path = `/orders/${placed.id}/confirm-cod`;
    const params = { orderId: placed.id };
    const confirmed = await data(await call(confirmCod, path, { params, body: { token } }));
    expect(confirmed).toEqual({
      orderNumber: placed.orderNumber,
      codConfirmedAt: expect.any(String),
    });

    const after = await db.order.findUniqueOrThrow({
      where: { id: placed.id },
      include: { statusHistory: { orderBy: { createdAt: "asc" } } },
    });
    expect(after).toMatchObject({
      status: "NEW",
      codConfirmationSource: "WHATSAPP",
      codConfirmationRecordedByEmployeeId: null,
    });
    expect(after.statusHistory.at(-1)).toMatchObject({
      fromStatus: "PENDING_CONFIRMATION",
      toStatus: "NEW",
      changedByType: "SYSTEM",
      reason: "COD_CONFIRMED_WHATSAPP",
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: placed.id, action: "ORDER_COD_CONFIRMED" },
    });
    expect(audit).toMatchObject({ actorType: "CUSTOMER", actorId: sara.customerId });
    expect(await events(placed.id, "ORDER_COD_CONFIRMED")).toHaveLength(1);

    // Opening the link again answers the same; no new link is issued.
    expect(await data(await call(confirmCod, path, { params, body: { token } }))).toEqual(
      confirmed,
    );
    expect(await events(placed.id, "ORDER_COD_CONFIRMED")).toHaveLength(1);
    await expect(getCodService().issueConfirmationToken(placed.id)).rejects.toMatchObject({
      code: "ORDER_STATE_INVALID",
    });
  });

  it("confirms a guest order and records a SYSTEM audit actor", async () => {
    const placed = await placeOrder();
    const { token } = await getCodService().issueConfirmationToken(placed.id);
    await data(
      await call(confirmCod, `/orders/${placed.id}/confirm-cod`, {
        params: { orderId: placed.id },
        body: { token },
      }),
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: placed.id, action: "ORDER_COD_CONFIRMED" },
    });
    expect(audit).toMatchObject({ actorType: "SYSTEM", actorId: null });
  });

  it("refuses unknown, malformed and other orders' tokens alike", async () => {
    const one = await placeOrder();
    const two = await placeOrder();
    const { token } = await getCodService().issueConfirmationToken(one.id);
    for (const [orderId, body] of [
      [two.id, { token }],
      [UNKNOWN_ID, { token }],
      [one.id, { token: "bfo_not-a-real-token" }],
      [one.id, { token: `bfo_${"A".repeat(43)}` }],
    ] as const) {
      const error = await errorOf(
        await call(confirmCod, `/orders/${orderId}/confirm-cod`, { params: { orderId }, body }),
        404,
      );
      expect(error.code).toBe("NOT_FOUND");
    }
    const bad = await errorOf(
      await call(confirmCod, `/orders/${one.id}/confirm-cod`, {
        params: { orderId: one.id },
        body: {},
      }),
      400,
    );
    expect(bad.code).toBe("VALIDATION_ERROR");
    expect((await db.order.findUniqueOrThrow({ where: { id: one.id } })).status).toBe(
      "PENDING_CONFIRMATION",
    );
  });

  it("refuses after the deadline, and an unused link of a confirmed order", async () => {
    const placed = await placeOrder();
    const { token } = await getCodService().issueConfirmationToken(placed.id);
    const late = await after(placed.id, 72);
    await expect(late.confirmByLink(placed.id, token, null, CTX)).rejects.toMatchObject({
      code: "ORDER_STATE_INVALID",
      details: { reason: "CONFIRMATION_DEADLINE_PASSED" },
    });
    await expect(late.issueConfirmationToken(placed.id)).rejects.toMatchObject({
      code: "ORDER_STATE_INVALID",
    });

    const other = await getCodService().issueConfirmationToken(placed.id);
    await getCodService().confirmByLink(placed.id, token, null, CTX);
    await expect(
      getCodService().confirmByLink(placed.id, other.token, null, CTX),
    ).rejects.toMatchObject({ code: "ORDER_STATE_INVALID", details: { status: "NEW" } });
  });

  it("is rate limited per IP", async () => {
    const placed = await placeOrder();
    const service = getCodService();
    for (let i = 0; i < 20; i++) {
      await expect(service.confirmByLink(placed.id, "bad", "10.0.0.9", CTX)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    await expect(service.confirmByLink(placed.id, "bad", "10.0.0.9", CTX)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});

describe("POST /admin/orders/{orderId}/record-phone-confirmation", () => {
  it("needs RECORD_COD_CONFIRMATION and records the staff member", async () => {
    const placed = await placeOrder();
    const params = { orderId: placed.id };
    const path = `/admin/orders/${placed.id}/record-phone-confirmation`;

    const viewer = await staff(["ORDERS_VIEW"]);
    expect(
      (await errorOf(await call(recordPhone, path, { params, token: viewer.token }), 403)).code,
    ).toBe("PERMISSION_DENIED");

    const agent = await staff(["RECORD_COD_CONFIRMATION"]);
    const order = await data(await call(recordPhone, path, { params, token: agent.token }));
    expect(order.status).toBe("NEW");
    expect(order.codConfirmation).toMatchObject({
      source: "PHONE",
      recordedByEmployeeId: agent.employeeId,
      confirmedAt: expect.any(String),
    });
    expect(order.statusHistory.at(-1)).toMatchObject({
      toStatus: "NEW",
      changedByType: "SYSTEM",
      reason: "COD_CONFIRMED_PHONE",
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: placed.id, action: "ORDER_COD_CONFIRMED" },
    });
    expect(audit).toMatchObject({ actorType: "EMPLOYEE", actorId: agent.employeeId });

    const again = await errorOf(await call(recordPhone, path, { params, token: agent.token }), 409);
    expect(again).toMatchObject({ code: "ORDER_STATE_INVALID", details: { status: "NEW" } });

    const unknown = await errorOf(
      await call(recordPhone, `/admin/orders/${UNKNOWN_ID}/record-phone-confirmation`, {
        params: { orderId: UNKNOWN_ID },
        token: agent.token,
      }),
      404,
    );
    expect(unknown.code).toBe("NOT_FOUND");
  });

  it("is refused after the deadline", async () => {
    const placed = await placeOrder();
    const agent = await staff(["RECORD_COD_CONFIRMATION"]);
    const permissions = new Set<PermissionCode>(["RECORD_COD_CONFIRMATION"]);
    await expect(
      (await after(placed.id, 73)).recordPhoneConfirmation(
        { employeeId: agent.employeeId, permissions },
        placed.id,
        CTX,
      ),
    ).rejects.toMatchObject({ details: { reason: "CONFIRMATION_DEADLINE_PASSED" } });
  });
});

describe("reminders", () => {
  it("queues one reminder per interval, at most the maximum, before the deadline", async () => {
    const placed = await placeOrder();
    expect(await (await after(placed.id, 23)).sendReminders()).toBe(0);
    expect(await (await after(placed.id, 24)).sendReminders()).toBe(1);
    expect(await (await after(placed.id, 30)).sendReminders()).toBe(0);
    expect(await (await after(placed.id, 48)).sendReminders()).toBe(1);
    expect(await (await after(placed.id, 71)).sendReminders()).toBe(0);
    expect(await events(placed.id, "COD_CONFIRMATION_REMINDER")).toHaveLength(2);
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order.codReminderCount).toBe(2);
  });

  it("sends none on the phone channel or for confirmed orders", async () => {
    const pending = await placeOrder();
    const confirmed = await placeOrder();
    const { token } = await getCodService().issueConfirmationToken(confirmed.id);
    await getCodService().confirmByLink(confirmed.id, token, null, CTX);
    expect(await (await after(pending.id, 25)).sendReminders()).toBe(1); // only `pending`

    await setSetting(SETTING_KEYS.codConfirmationChannel, "PHONE", "STRING");
    expect(await (await after(pending.id, 49)).sendReminders()).toBe(0);
  });
});

describe("expiry", () => {
  it("expires at the deadline and gives the stock back; the order is kept", async () => {
    const placed = await placeOrder();
    const confirmed = await placeOrder();
    const { token } = await getCodService().issueConfirmationToken(confirmed.id);
    await getCodService().confirmByLink(confirmed.id, token, null, CTX);

    expect(await (await after(placed.id, 71)).expireOrders()).toBe(0);
    const late = await after(placed.id, 72);
    expect(await late.expireOrders()).toBe(1);
    expect(await late.expireOrders()).toBe(0);

    const order = await db.order.findUniqueOrThrow({
      where: { id: placed.id },
      include: { statusHistory: { orderBy: { createdAt: "asc" } }, reservations: true },
    });
    expect(order.status).toBe("EXPIRED");
    expect(order.expiredAt).not.toBeNull();
    expect(order.statusHistory.at(-1)).toMatchObject({
      toStatus: "EXPIRED",
      changedByType: "SYSTEM",
      reason: "COD_CONFIRMATION_TIMEOUT",
    });
    expect(order.reservations.map((r) => r.status)).toEqual(["RELEASED"]);
    expect(await events(placed.id, "ORDER_EXPIRED")).toHaveLength(1);
    expect(
      await db.auditLog.count({ where: { entityId: placed.id, action: "ORDER_EXPIRED" } }),
    ).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: confirmed.id } })).status).toBe("NEW");
  });
});
