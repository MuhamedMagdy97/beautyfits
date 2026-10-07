import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PUT as chooseDiscount } from "@/app/api/v1/cart/discount/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { POST as validate } from "@/app/api/v1/checkout/validate/route";
import { POST as modify } from "@/app/api/v1/orders/[orderId]/modify/route";
import { POST as confirmRevision } from "@/app/api/v1/orders/[orderId]/revisions/[revisionId]/confirm/route";
import { GET as myOrder } from "@/app/api/v1/orders/[orderId]/route";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { logger } from "@/server/logging/logger";
import { SYSTEM_ACTOR } from "@/server/modules/audit/audit";
import { createSession } from "@/server/modules/auth/sessions";
import { changeOrderStatus } from "@/server/modules/orders/orders";
import { createRevisionsService } from "@/server/modules/orders/revisions-service";
import { creditWallet } from "@/server/modules/wallet/wallet-service";
import { fixedClock, MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Order modification and re-confirmation (TASK-032, C5, Q32, R40). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const CTX = { logger, correlationId: null };

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
let otherAreaId: string;

async function variant(price: number, stock = 10) {
  counter += 1;
  const created = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      status: "PUBLISHED",
      firstPublishedAt: new Date(),
      variants: {
        create: [
          {
            sku: `SKU-${counter}`,
            isDefault: true,
            sellingPrice: BigInt(price),
            weightedAverageCost: BigInt(1000),
          },
        ],
      },
    },
    include: { variants: true },
  });
  const variantId = created.variants[0].id;
  await db.inventoryMovement.create({
    data: {
      productVariantId: variantId,
      movementType: "MANUAL_ADJUSTMENT",
      availableDelta: stock,
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

const ADDRESS = (area = areaId) => ({
  recipientName: "Mona",
  phone: "01012345678",
  areaId: area,
  street: "9 Road 9",
});

/** A customer COD order through checkout. */
async function placeOrder(
  token: string,
  lines: { variantId: string; quantity: number }[],
  extra: { discountId?: string; walletAmount?: number } = {},
) {
  counter += 1;
  for (const line of lines) {
    await data(await call(addItem, "/cart/items", { token, body: line }));
  }
  if (extra.discountId) {
    await data(
      await call(chooseDiscount, "/cart/discount", {
        method: "PUT",
        token,
        body: { discountId: extra.discountId },
      }),
    );
  }
  const body = { address: ADDRESS(), walletAmount: extra.walletAmount ?? 0 };
  const quote = await data(await call(validate, "/checkout/validate", { token, body }));
  return data(
    await call(checkout, "/checkout", {
      token,
      key: `o-${counter}`,
      body: { ...body, expectedTotal: quote.total },
    }),
    201,
  );
}

function modifyOrder(orderId: string, token: string, body: unknown) {
  return call(modify, `/orders/${orderId}/modify`, { token, params: { orderId }, body });
}

function confirmIt(orderId: string, revisionId: string, token: string) {
  return call(confirmRevision, `/orders/${orderId}/revisions/${revisionId}/confirm`, {
    token,
    params: { orderId, revisionId },
  });
}

function moveTo(orderId: string, ...steps: ("NEW" | "CONFIRMED" | "PREPARING")[]) {
  return runInTransaction(async (tx) => {
    for (const to of steps) {
      await changeOrderStatus(tx, { orderId, to, actor: SYSTEM_ACTOR, now: new Date() });
    }
  });
}

async function activeReserved(orderId: string) {
  const rows = await db.inventoryReservation.findMany({ where: { orderId, status: "ACTIVE" } });
  return Object.fromEntries(rows.map((r) => [r.productVariantId, r.quantity]));
}

beforeEach(async () => {
  await resetDatabase();
  const cairo = await db.governorate.findUniqueOrThrow({ where: { code: "C" } });
  areaId = (
    await db.area.create({ data: { governorateId: cairo.id, nameAr: "المعادي", nameEn: "Maadi" } })
  ).id;
  otherAreaId = (
    await db.area.create({
      data: { governorateId: cairo.id, nameAr: "الزمالك", nameEn: "Zamalek" },
    })
  ).id;
  await db.shippingRule.create({ data: { shippingFee: BigInt(5000) } });
  await db.shippingRule.create({
    data: { shippingFee: BigInt(7000), governorateId: cairo.id, areaId: otherAreaId },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("modify and confirm", () => {
  it("keeps the order price, prices extra quantity today, and changes the order only on confirmation", async () => {
    const sara = await customer();
    const a = await variant(15000);
    const b = await variant(4000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 2 }]);
    expect(order.total).toBe(35000); // 30000 + 5000 shipping

    await db.productVariant.update({ where: { id: a }, data: { sellingPrice: BigInt(16000) } });
    const revision = await data(
      await modifyOrder(order.id, sara.token, {
        items: [
          { variantId: a, quantity: 3 },
          { variantId: b, quantity: 1 },
        ],
      }),
      201,
    );
    expect(revision).toMatchObject({
      revisionNumber: 1,
      status: "PENDING_CONFIRMATION",
      oldTotal: 35000,
      newTotal: 55000, // 2×15000 + 16000 + 4000 + 5000
    });
    expect(revision.proposed.items).toEqual([
      expect.objectContaining({ variantId: a, unitPrice: 15000, quantity: 2 }),
      expect.objectContaining({ variantId: a, unitPrice: 16000, quantity: 1 }),
      expect.objectContaining({ variantId: b, unitPrice: 4000, quantity: 1 }),
    ]);

    // Nothing changed yet; the customer sees the open change.
    const before = await data(
      await call(myOrder, `/orders/${order.id}`, {
        method: "GET",
        token: sara.token,
        params: { orderId: order.id },
      }),
    );
    expect(before.total).toBe(35000);
    expect(before.pendingRevision.id).toBe(revision.id);

    const after = await data(await confirmIt(order.id, revision.id, sara.token));
    expect(after).toMatchObject({ total: 55000, subtotal: 50000, pendingRevision: null });
    expect(after.items).toHaveLength(3);
    expect(await activeReserved(order.id)).toEqual({ [a]: 3, [b]: 1 });

    const stored = await db.orderRevision.findUniqueOrThrow({ where: { id: revision.id } });
    expect(stored).toMatchObject({ status: "CONFIRMED" });
    expect(stored.previousSnapshot).toMatchObject({ total: 35000 });
    expect(
      await db.auditLog.count({
        where: {
          entityId: order.id,
          action: { in: ["ORDER_REVISION_REQUESTED", "ORDER_REVISED"] },
        },
      }),
    ).toBe(2);
    expect(
      await db.outboxEvent.count({ where: { aggregateId: order.id, eventType: "ORDER_REVISED" } }),
    ).toBe(1);

    // Removing an item gives its stock back.
    const smaller = await data(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 1 }] }),
      201,
    );
    expect(smaller.proposed.items).toEqual([
      expect.objectContaining({ variantId: a, unitPrice: 15000, quantity: 1 }),
    ]);
    await data(await confirmIt(order.id, smaller.id, sara.token));
    expect(await activeReserved(order.id)).toEqual({ [a]: 1 });
  });

  it("sends a Confirmed order back to New for another staff review", async () => {
    const sara = await customer();
    const a = await variant(10000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 1 }]);
    await moveTo(order.id, "NEW", "CONFIRMED");
    const revision = await data(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 2 }] }),
      201,
    );
    await data(await confirmIt(order.id, revision.id, sara.token));
    const row = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { statusHistory: { orderBy: { createdAt: "asc" } } },
    });
    expect(row.status).toBe("NEW");
    expect(row.statusHistory.at(-1)).toMatchObject({
      fromStatus: "CONFIRMED",
      toStatus: "NEW",
      changedByType: "CUSTOMER",
      reason: "ORDER_REVISED",
    });
  });

  it("re-quotes shipping for a new address", async () => {
    const sara = await customer();
    const a = await variant(10000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 1 }]);
    const revision = await data(
      await modifyOrder(order.id, sara.token, {
        items: [{ variantId: a, quantity: 1 }],
        address: ADDRESS(otherAreaId),
      }),
      201,
    );
    expect(revision.proposed).toMatchObject({ shippingFee: 7000, total: 17000 });
    await data(await confirmIt(order.id, revision.id, sara.token));
    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect((row.shippingAddressSnapshot as { area: { id: string } }).area.id).toBe(otherAreaId);
  });
});

describe("discount", () => {
  async function tenPercent(minimum: number | null = null) {
    const account = await db.account.create({
      data: {
        accountType: "EMPLOYEE",
        email: `staff${++counter}@beautyfits.example`,
        emailVerifiedAt: new Date(),
        passwordHash: "unused",
        status: "ACTIVE",
        employee: { create: { displayName: "Staff", employeeLevel: "ADMIN" } },
      },
      include: { employee: true },
    });
    return db.discount.create({
      data: {
        nameAr: "خصم",
        nameEn: "Sale",
        value: 10,
        scope: "STORE_WIDE",
        minimumOrderTotal: minimum === null ? null : BigInt(minimum),
        startsAt: new Date(Date.now() - MS_PER_HOUR),
        status: "ACTIVE",
        createdByEmployeeId: account.employee!.id,
      },
    });
  }

  it("keeps the order-time terms even if the discount changed since", async () => {
    const sara = await customer();
    const a = await variant(10000);
    const discount = await tenPercent();
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 1 }], {
      discountId: discount.id,
    });
    expect(order.discountTotal).toBe(1000);
    await db.discount.update({
      where: { id: discount.id },
      data: { value: 50, status: "INACTIVE" },
    });

    const revision = await data(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 2 }] }),
      201,
    );
    expect(revision.proposed).toMatchObject({ discountTotal: 2000, discountDropped: false });
    await data(await confirmIt(order.id, revision.id, sara.token));
    expect(await db.discountUsage.findUnique({ where: { orderId: order.id } })).toMatchObject({
      discountAmount: BigInt(2000),
      releasedAt: null,
    });
  });

  it("drops the discount when its minimum is no longer met and gives the use back", async () => {
    const sara = await customer();
    const a = await variant(10000);
    const discount = await tenPercent(20000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 2 }], {
      discountId: discount.id,
    });
    const revision = await data(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 1 }] }),
      201,
    );
    expect(revision.proposed).toMatchObject({ discountTotal: 0, discountDropped: true });
    await data(await confirmIt(order.id, revision.id, sara.token));
    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({ appliedDiscountId: null, discountSnapshot: null });
    expect(
      (await db.discountUsage.findUniqueOrThrow({ where: { orderId: order.id } })).releasedAt,
    ).not.toBeNull();
  });
});

describe("wallet", () => {
  it("moves the hold and, when it covers everything, needs no COD confirmation", async () => {
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
    const a = await variant(10000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 1 }], {
      walletAmount: 5000,
    });
    expect(order.status).toBe("PENDING_CONFIRMATION");

    const tooMuch = await errorOf(
      await modifyOrder(order.id, sara.token, {
        items: [{ variantId: a, quantity: 1 }],
        walletAmount: 25000,
      }),
      400,
    );
    expect(tooMuch.code).toBe("VALIDATION_ERROR");

    const revision = await data(
      await modifyOrder(order.id, sara.token, {
        items: [{ variantId: a, quantity: 1 }],
        walletAmount: 15000,
      }),
      201,
    );
    expect(revision.proposed).toMatchObject({ walletAmount: 15000, codAmount: 0 });
    await data(await confirmIt(order.id, revision.id, sara.token));
    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({ status: "NEW", walletAmountReserved: BigInt(15000) });
    const holds = await db.walletReservation.findMany({ where: { orderId: order.id } });
    expect(holds.map((h) => [h.status, h.amount])).toEqual(
      expect.arrayContaining([
        ["RELEASED", BigInt(5000)],
        ["ACTIVE", BigInt(15000)],
      ]),
    );
  });
});

describe("refusals", () => {
  it("only the owner, only before Preparing, only with a change", async () => {
    const sara = await customer();
    const other = await customer();
    const a = await variant(10000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 1 }]);
    const items = [{ variantId: a, quantity: 2 }];

    expect((await errorOf(await modifyOrder(order.id, other.token, { items }), 404)).code).toBe(
      "NOT_FOUND",
    );
    expect((await errorOf(await modifyOrder(order.id, "", { items }), 401)).code).toBe(
      "UNAUTHENTICATED",
    );
    const same = await errorOf(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 1 }] }),
      409,
    );
    expect(same).toMatchObject({ code: "CONFLICT", details: { reason: "NO_CHANGE" } });
    const dup = await errorOf(
      await modifyOrder(order.id, sara.token, { items: [...items, ...items] }),
      400,
    );
    expect(dup.code).toBe("VALIDATION_ERROR");

    const open = await data(await modifyOrder(order.id, sara.token, { items }), 201);
    await moveTo(order.id, "NEW", "CONFIRMED", "PREPARING");
    expect(await errorOf(await modifyOrder(order.id, sara.token, { items }), 409)).toMatchObject({
      code: "ORDER_STATE_INVALID",
      details: { reason: "NOT_EDITABLE" },
    });
    expect(await errorOf(await confirmIt(order.id, open.id, sara.token), 409)).toMatchObject({
      code: "ORDER_STATE_INVALID",
    });
  });

  it("refuses more than the stock available", async () => {
    const sara = await customer();
    const a = await variant(10000, 3);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 2 }]);
    // 2 held by the order + 1 available: 3 is fine, 4 is not.
    await data(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 3 }] }),
      201,
    );
    const short = await errorOf(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 4 }] }),
      409,
    );
    expect(short.code).toBe("STOCK_CHANGED");
  });

  it("a newer revision replaces an open one; old or lapsed ones cannot be confirmed", async () => {
    const sara = await customer();
    const a = await variant(10000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 1 }]);
    const first = await data(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 2 }] }),
      201,
    );
    const second = await data(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 3 }] }),
      201,
    );
    expect(second.revisionNumber).toBe(2);
    expect(await errorOf(await confirmIt(order.id, first.id, sara.token), 409)).toMatchObject({
      code: "CONFLICT",
      details: { reason: "REVISION_SUPERSEDED" },
    });

    const late = createRevisionsService({
      db,
      clock: fixedClock(new Date(Date.now() + 24 * MS_PER_HOUR + 1000)),
    });
    await expect(
      late.confirm(sara.customerId, order.id, second.id, "en", CTX),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "REVISION_EXPIRED" } });
  });

  it("asks to review again when today's price changed before confirming", async () => {
    const sara = await customer();
    const a = await variant(10000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 1 }]);
    const revision = await data(
      await modifyOrder(order.id, sara.token, { items: [{ variantId: a, quantity: 2 }] }),
      201,
    );
    await db.productVariant.update({ where: { id: a }, data: { sellingPrice: BigInt(11000) } });
    expect(await errorOf(await confirmIt(order.id, revision.id, sara.token), 409)).toMatchObject({
      code: "RECONFIRMATION_REQUIRED",
      details: { reason: "REVISION_CHANGED" },
    });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).total).toBe(
      BigInt(15000),
    );
  });

  it("the database still refuses order changes outside a revision", async () => {
    const sara = await customer();
    const a = await variant(10000);
    const order = await placeOrder(sara.token, [{ variantId: a, quantity: 1 }]);
    await expect(
      db.order.update({ where: { id: order.id }, data: { total: BigInt(1) } }),
    ).rejects.toThrow();
    await expect(db.orderItem.deleteMany({ where: { orderId: order.id } })).rejects.toThrow();
  });
});
