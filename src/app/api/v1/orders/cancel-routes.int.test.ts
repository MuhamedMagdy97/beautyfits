import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as adminCancel } from "@/app/api/v1/admin/orders/[orderId]/cancel/route";
import { PUT as chooseDiscount } from "@/app/api/v1/cart/discount/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { POST as validate } from "@/app/api/v1/checkout/validate/route";
import { POST as cancel } from "@/app/api/v1/orders/[orderId]/cancel/route";
import type { OrderStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { SYSTEM_ACTOR } from "@/server/modules/audit/audit";
import { createSession } from "@/server/modules/auth/sessions";
import { createCodService } from "@/server/modules/orders/cod-service";
import { changeOrderStatus } from "@/server/modules/orders/orders";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { creditWallet } from "@/server/modules/wallet/wallet-service";
import { fixedClock, MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Cancellation before carrier pickup (TASK-033, Q10, Q33, Q86, Q87, R3, R11, R16, R36). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    token?: string;
    key?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.key) headers.set("idempotency-key", `checkout-${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "POST",
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
        create: [{ sku: `SKU-${counter}`, isDefault: true, sellingPrice: BigInt(10000) }],
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

/** A customer COD order through checkout: 2 units of a new variant. */
async function placeOrder(
  token: string,
  extra: { discountId?: string; walletAmount?: number } = {},
): Promise<{ id: string; variantId: string }> {
  counter += 1;
  const variantId = await variant();
  await data(await call(addItem, "/cart/items", { token, body: { variantId, quantity: 2 } }));
  if (extra.discountId) {
    await data(
      await call(chooseDiscount, "/cart/discount", {
        method: "PUT",
        token,
        body: { discountId: extra.discountId },
      }),
    );
  }
  const address = { recipientName: "Mona", phone: "01012345678", areaId, street: "9 Road 9" };
  const body = { address, walletAmount: extra.walletAmount ?? 0 };
  const quote = await data(await call(validate, "/checkout/validate", { token, body }));
  const order = await data(
    await call(checkout, "/checkout", {
      token,
      key: `o-${counter}`,
      body: { ...body, expectedTotal: quote.total },
    }),
    201,
  );
  return { id: order.id, variantId };
}

/** Walks the order along the state machine as the System (test shortcut). */
async function moveTo(orderId: string, path: OrderStatus[]) {
  for (const to of path) {
    await runInTransaction((tx) =>
      changeOrderStatus(tx, { orderId, to, actor: SYSTEM_ACTOR, now: new Date() }),
    );
  }
}

const TO_READY: OrderStatus[] = ["NEW", "CONFIRMED", "PREPARING", "READY_FOR_SHIPMENT"];

function cancelMine(orderId: string, token?: string, body?: unknown) {
  return call(cancel, `/orders/${orderId}/cancel`, { token, params: { orderId }, body });
}

function cancelAsStaff(orderId: string, token: string, body?: unknown) {
  return call(adminCancel, `/admin/orders/${orderId}/cancel`, {
    token,
    params: { orderId },
    body,
  });
}

async function available(variantId: string) {
  const balance = await db.inventoryBalance.findUniqueOrThrow({
    where: { productVariantId: variantId },
  });
  return { available: balance.availableQuantity, reserved: balance.reservedQuantity };
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

describe("POST /orders/{orderId}/cancel", () => {
  it("cancels and gives back stock, discount use and wallet hold in one step", async () => {
    const sara = await customer();
    await runInTransaction((tx) =>
      creditWallet(tx, {
        customerId: sara.customerId,
        transactionType: "RETURN_REFUND",
        amount: BigInt(20000),
        referenceType: "RETURN",
        referenceId: randomUUID(),
        now: new Date(),
      }),
    );
    const admin = await staff([]);
    const discount = await db.discount.create({
      data: {
        nameAr: "خصم",
        nameEn: "Sale",
        value: 10,
        scope: "STORE_WIDE",
        startsAt: new Date(Date.now() - MS_PER_HOUR),
        status: "ACTIVE",
        createdByEmployeeId: admin.employeeId,
      },
    });
    const placed = await placeOrder(sara.token, { discountId: discount.id, walletAmount: 5000 });
    expect(await available(placed.variantId)).toEqual({ available: 8, reserved: 2 });

    const view = await data(await cancelMine(placed.id, sara.token, { reason: "Changed my mind" }));
    expect(view).toMatchObject({ id: placed.id, status: "CANCELLED" });
    expect(view.statusHistory.at(-1).status).toBe("CANCELLED");

    const order = await db.order.findUniqueOrThrow({
      where: { id: placed.id },
      include: {
        statusHistory: { orderBy: { createdAt: "asc" } },
        reservations: true,
        discountUsage: true,
        walletHolds: true,
      },
    });
    expect(order.cancelledAt).not.toBeNull();
    expect(order.statusHistory.at(-1)).toMatchObject({
      fromStatus: "PENDING_CONFIRMATION",
      toStatus: "CANCELLED",
      changedByType: "CUSTOMER",
      changedById: sara.customerId,
      reason: "Changed my mind",
    });
    expect(order.reservations.map((r) => r.status)).toEqual(["RELEASED"]);
    expect(await available(placed.variantId)).toEqual({ available: 10, reserved: 0 });
    expect(order.discountUsage!.releasedAt).not.toBeNull();
    expect(order.walletHolds.map((h) => h.status)).toEqual(["RELEASED"]);
    const wallet = await db.wallet.findUniqueOrThrow({ where: { customerId: sara.customerId } });
    expect(wallet.balance).toBe(BigInt(20000)); // a hold never moved the balance

    expect(
      await db.auditLog.findFirst({ where: { entityId: placed.id, action: "ORDER_CANCELLED" } }),
    ).toMatchObject({ actorType: "CUSTOMER", actorId: sara.customerId, reason: "Changed my mind" });
    expect(
      await db.outboxEvent.count({
        where: { aggregateId: placed.id, eventType: "ORDER_CANCELLED" },
      }),
    ).toBe(1);

    // A second cancel is refused; nothing is released twice.
    const again = await errorOf(await cancelMine(placed.id, sara.token), 422);
    expect(again).toMatchObject({
      code: "ORDER_CANCELLATION_NOT_ALLOWED",
      details: { status: "CANCELLED" },
    });
    expect(await available(placed.variantId)).toEqual({ available: 10, reserved: 0 });
  });

  it("is allowed in every status before carrier pickup, without a reason", async () => {
    const sara = await customer();
    for (let i = 1; i <= TO_READY.length; i += 1) {
      const placed = await placeOrder(sara.token);
      await moveTo(placed.id, TO_READY.slice(0, i));
      const view = await data(await cancelMine(placed.id, sara.token));
      expect(view.status).toBe("CANCELLED");
      expect(await available(placed.variantId)).toEqual({ available: 10, reserved: 0 });
    }
  });

  it("is refused after carrier pickup and for finished orders; a shipped order stays shipped", async () => {
    const sara = await customer();
    const shipped = await placeOrder(sara.token);
    await moveTo(shipped.id, [...TO_READY, "SHIPPED"]);
    const error = await errorOf(await cancelMine(shipped.id, sara.token), 422);
    expect(error).toMatchObject({
      code: "ORDER_CANCELLATION_NOT_ALLOWED",
      details: { status: "SHIPPED", reason: "AFTER_CARRIER_PICKUP" },
    });
    expect((await db.order.findUniqueOrThrow({ where: { id: shipped.id } })).status).toBe(
      "SHIPPED",
    );

    const delivered = await placeOrder(sara.token);
    await moveTo(delivered.id, [...TO_READY, "SHIPPED", "DELIVERED"]);
    expect((await errorOf(await cancelMine(delivered.id, sara.token), 422)).details.status).toBe(
      "DELIVERED",
    );
  });

  it("refuses an expired order, and the expiry job skips a cancelled one", async () => {
    const sara = await customer();
    const expired = await placeOrder(sara.token);
    const cancelled = await placeOrder(sara.token);
    await data(await cancelMine(cancelled.id, sara.token));

    const { createdAt } = await db.order.findUniqueOrThrow({ where: { id: expired.id } });
    const late = createCodService({
      db,
      clock: fixedClock(new Date(createdAt.getTime() + 73 * MS_PER_HOUR)),
    });
    expect(await late.expireOrders()).toBe(1); // only `expired`
    expect((await db.order.findUniqueOrThrow({ where: { id: cancelled.id } })).status).toBe(
      "CANCELLED",
    );

    const error = await errorOf(await cancelMine(expired.id, sara.token), 422);
    expect(error).toMatchObject({
      code: "ORDER_CANCELLATION_NOT_ALLOWED",
      details: { status: "EXPIRED" },
    });
  });

  it("is only for the signed-in owner (guests have no online cancellation)", async () => {
    const sara = await customer();
    const other = await customer();
    const placed = await placeOrder(sara.token);

    expect((await errorOf(await cancelMine(placed.id), 401)).code).toBe("UNAUTHENTICATED");
    expect((await errorOf(await cancelMine(placed.id, other.token), 404)).code).toBe("NOT_FOUND");
    expect((await errorOf(await cancelMine(UNKNOWN_ID, sara.token), 404)).code).toBe("NOT_FOUND");
    const tooLong = await errorOf(
      await cancelMine(placed.id, sara.token, { reason: "x".repeat(501) }),
      400,
    );
    expect(tooLong.code).toBe("VALIDATION_ERROR");
    expect((await db.order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe(
      "PENDING_CONFIRMATION",
    );
  });
});

describe("POST /admin/orders/{orderId}/cancel", () => {
  it("needs CANCEL_ORDER and a reason, and records the staff member", async () => {
    const sara = await customer();
    const placed = await placeOrder(sara.token);
    await moveTo(placed.id, TO_READY);
    const viewer = await staff(["ORDERS_VIEW"]);
    const agent = await staff(["CANCEL_ORDER"]);

    const denied = await errorOf(
      await cancelAsStaff(placed.id, viewer.token, { reason: "x" }),
      403,
    );
    expect(denied.code).toBe("PERMISSION_DENIED");
    expect((await errorOf(await cancelAsStaff(placed.id, agent.token, {}), 400)).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      (await errorOf(await cancelAsStaff(placed.id, agent.token, { reason: "  " }), 400)).code,
    ).toBe("VALIDATION_ERROR");

    const view = await data(
      await cancelAsStaff(placed.id, agent.token, { reason: "Customer called" }),
    );
    expect(view).toMatchObject({ status: "CANCELLED" });
    expect(view.cancelledAt).not.toBeNull();
    expect(view.statusHistory.at(-1)).toMatchObject({
      fromStatus: "READY_FOR_SHIPMENT",
      toStatus: "CANCELLED",
      changedByType: "EMPLOYEE",
      changedById: agent.employeeId,
      reason: "Customer called",
    });
    expect(await available(placed.variantId)).toEqual({ available: 10, reserved: 0 });
    expect(
      await db.auditLog.findFirst({ where: { entityId: placed.id, action: "ORDER_CANCELLED" } }),
    ).toMatchObject({ actorType: "EMPLOYEE", actorId: agent.employeeId });

    const unknown = await errorOf(
      await cancelAsStaff(UNKNOWN_ID, agent.token, { reason: "x" }),
      404,
    );
    expect(unknown.code).toBe("NOT_FOUND");
  });

  it("refuses a shipped order (staff use the shipping cancellation request)", async () => {
    const sara = await customer();
    const placed = await placeOrder(sara.token);
    await moveTo(placed.id, [...TO_READY, "SHIPPED"]);
    const agent = await staff(["CANCEL_ORDER"]);
    const error = await errorOf(await cancelAsStaff(placed.id, agent.token, { reason: "x" }), 422);
    expect(error).toMatchObject({
      code: "ORDER_CANCELLATION_NOT_ALLOWED",
      details: { status: "SHIPPED", reason: "AFTER_CARRIER_PICKUP" },
    });
  });
});
