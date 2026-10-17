import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createPurchase } from "@/app/api/v1/admin/purchases/route";
import { POST as receivePurchase } from "@/app/api/v1/admin/purchases/[id]/receive/route";
import { POST as submitPurchase } from "@/app/api/v1/admin/purchases/[id]/submit/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { logger } from "@/server/logging/logger";
import { createSession } from "@/server/modules/auth/sessions";
import { createCodService, getCodService } from "@/server/modules/orders/cod-service";
import { getOrdersService } from "@/server/modules/orders/orders-service";
import { getRevisionsService } from "@/server/modules/orders/revisions-service";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { creditWallet, getWalletService } from "@/server/modules/wallet/wallet-service";
import { fixedClock, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "@/server/time/time";
import { concurrently, fulfilled, rejected } from "@/test/integration/concurrently";
import { resetDatabase } from "@/test/integration/database";

/**
 * Concurrency & reliability (TASK-062): critical races run against real
 * PostgreSQL. Each test fires the competing operations at once and checks
 * the invariants that must hold whatever order they ran in.
 */

const db = getDb();
const BASE = "http://localhost/api/v1";
const CTX = { logger, correlationId: null };
const SHIPPING_FEE = 5000;
const PRICE = 15000;

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    token?: string;
    guest?: string;
    headers?: Record<string, string>;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en", ...options.headers });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.guest) headers.set("x-guest-cart-token", options.guest);
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

let counter = 0;
let areaId: string;

async function variant(stock: number) {
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
            sellingPrice: BigInt(PRICE),
            weightedAverageCost: BigInt(9000),
          },
        ],
      },
    },
    include: { variants: true },
  });
  const variantId = created.variants[0].id;
  if (stock > 0) {
    await db.inventoryMovement.create({
      data: {
        productVariantId: variantId,
        movementType: "MANUAL_ADJUSTMENT",
        availableDelta: stock,
        reason: "Test stock",
        createdByType: "SYSTEM",
      },
    });
  }
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

/** An Owner (all permissions) with a session. */
async function owner() {
  counter += 1;
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `owner${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: { create: { displayName: `Owner ${counter}`, employeeLevel: "OWNER" } },
    },
    include: { employee: true },
  });
  const session = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  const permissions = new Set(
    (await db.permission.findMany({ select: { code: true } })).map((p) => p.code),
  ) as ReadonlySet<PermissionCode>;
  return { employeeId: account.employee!.id, permissions, token: session.tokens.accessToken };
}

async function addToCart(variantId: string, quantity: number, who: { token?: string } = {}) {
  const cart = await data(
    await call(addItem, "/cart/items", { ...who, body: { variantId, quantity } }),
  );
  return cart.guestCartToken as string | undefined;
}

const ADDRESS = () => ({ recipientName: "Mona", phone: "01012345678", areaId, street: "9 Road 9" });
const CONTACT = { fullName: "Mona Adel", phone: "01012345678" };

function guestCheckout(guest: string, key: string, quantity = 1) {
  return call(checkout, "/checkout", {
    guest,
    headers: { "idempotency-key": `task062-${key}` },
    body: {
      contact: CONTACT,
      address: ADDRESS(),
      expectedTotal: PRICE * quantity + SHIPPING_FEE,
    },
  });
}

function customerCheckout(token: string, key: string, walletAmount = 0, quantity = 1) {
  return call(checkout, "/checkout", {
    token,
    headers: { "idempotency-key": `task062-${key}` },
    body: { address: ADDRESS(), walletAmount, expectedTotal: PRICE * quantity + SHIPPING_FEE },
  });
}

async function fund(customerId: string, amount: number) {
  await runInTransaction((tx) =>
    creditWallet(tx, {
      customerId,
      transactionType: "RETURN_REFUND",
      amount: BigInt(amount),
      referenceType: "RETURN",
      referenceId: randomUUID(),
      now: new Date(),
    }),
  );
}

/** The stock balance, checked against the sum of its movements (invariant 14). */
async function stock(variantId: string) {
  const balance = await db.inventoryBalance.findUniqueOrThrow({
    where: { productVariantId: variantId },
  });
  const sums = await db.inventoryMovement.aggregate({
    where: { productVariantId: variantId },
    _sum: { availableDelta: true, reservedDelta: true, damagedDelta: true },
  });
  const result = {
    available: balance.availableQuantity,
    reserved: balance.reservedQuantity,
    damaged: balance.damagedQuantity,
  };
  expect(result).toEqual({
    available: sums._sum.availableDelta ?? 0,
    reserved: sums._sum.reservedDelta ?? 0,
    damaged: sums._sum.damagedDelta ?? 0,
  });
  expect(Math.min(result.available, result.reserved, result.damaged)).toBeGreaterThanOrEqual(0);
  return result;
}

/** The wallet, checked against its ledger and its holds (invariant 6). */
async function wallet(customerId: string) {
  const row = await db.wallet.findUniqueOrThrow({ where: { customerId } });
  const sides = await db.walletTransaction.groupBy({
    by: ["direction"],
    where: { walletId: row.id },
    _sum: { amount: true },
  });
  const side = (d: string) => sides.find((s) => s.direction === d)?._sum.amount ?? BigInt(0);
  expect(row.balance).toBe(side("CREDIT") - side("DEBIT"));
  const held =
    (
      await db.walletReservation.aggregate({
        where: { walletId: row.id, status: "ACTIVE" },
        _sum: { amount: true },
      })
    )._sum.amount ?? BigInt(0);
  expect(row.balance).toBeGreaterThanOrEqual(BigInt(0));
  expect(row.balance - held).toBeGreaterThanOrEqual(BigInt(0));
  return { balance: Number(row.balance), held: Number(held) };
}

/** Each history row starts where the previous one ended (no lost or doubled move). */
async function historyChain(orderId: string) {
  const rows = await db.orderStatusHistory.findMany({
    where: { orderId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  rows.forEach((row, i) => expect(row.fromStatus).toBe(i === 0 ? null : rows[i - 1].toStatus));
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  expect(rows.at(-1)!.toStatus).toBe(order.status);
  return rows.map((r) => r.toStatus);
}

function code(error: unknown) {
  return (error as { code?: string }).code;
}

beforeEach(async () => {
  await resetDatabase();
  const cairo = await db.governorate.findUniqueOrThrow({ where: { code: "C" } });
  areaId = (
    await db.area.create({ data: { governorateId: cairo.id, nameAr: "المعادي", nameEn: "Maadi" } })
  ).id;
  await db.shippingRule.create({ data: { shippingFee: BigInt(SHIPPING_FEE) } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("checkout races", () => {
  it("sells exactly the last units when many shoppers check out at once", async () => {
    const variantId = await variant(2);
    const guests: string[] = [];
    for (let i = 0; i < 8; i++) guests.push((await addToCart(variantId, 1))!);

    const responses = fulfilled(
      await concurrently(8, (i) => guestCheckout(guests[i], `last-${i}`)),
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 201, 409, 409, 409, 409, 409, 409]);
    for (const body of bodies.filter((b) => b.error)) {
      expect(body.error.code).toBe("STOCK_CHANGED");
    }
    expect(await db.order.count()).toBe(2);
    expect(await db.checkoutAttempt.count()).toBe(2);
    expect(await db.inventoryReservation.count({ where: { status: "ACTIVE" } })).toBe(2);
    expect(await stock(variantId)).toEqual({ available: 0, reserved: 2, damaged: 0 });
  });

  it("places one order when the same Idempotency-Key is sent many times at once", async () => {
    const variantId = await variant(5);
    const guest = (await addToCart(variantId, 1))!;

    const responses = fulfilled(await concurrently(5, () => guestCheckout(guest, "same-key")));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const ids = new Set((await Promise.all(responses.map((r) => r.json()))).map((b) => b.data.id));
    expect(ids.size).toBe(1);
    expect(await db.order.count()).toBe(1);
    expect(await db.checkoutAttempt.count()).toBe(1);
    expect(await stock(variantId)).toEqual({ available: 4, reserved: 1, damaged: 0 });
  });

  it("places one order when a customer submits the cart twice with different keys", async () => {
    const { token } = await customer();
    const variantId = await variant(5);
    await addToCart(variantId, 1, { token });

    const responses = fulfilled(await concurrently(4, (i) => customerCheckout(token, `dbl-${i}`)));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    for (const body of bodies.filter((b) => b.error)) {
      expect(body.error.details.reason).toBe("CART_EMPTY");
    }
    expect(await db.order.count()).toBe(1);
    expect(await stock(variantId)).toEqual({ available: 4, reserved: 1, damaged: 0 });
  });
});

describe("wallet double-spend", () => {
  it("never overdraws when debits beyond the balance run at once", async () => {
    const { customerId } = await customer();
    const admin = await owner();
    await fund(customerId, 50_000);

    const results = await concurrently(6, (i) =>
      getWalletService().adjust(
        admin,
        customerId,
        { direction: "DEBIT", amount: BigInt(20_000), reason: "Correction" },
        `debit-${i}`,
        CTX,
      ),
    );
    expect(fulfilled(results)).toHaveLength(2);
    expect(rejected(results).map(code)).toEqual(Array(4).fill("WALLET_INSUFFICIENT_FUNDS"));
    expect(await wallet(customerId)).toEqual({ balance: 10_000, held: 0 });
  });

  it("posts one ledger entry when the same adjustment key is sent at once", async () => {
    const { customerId } = await customer();
    const admin = await owner();
    const results = await concurrently(5, () =>
      getWalletService().adjust(
        admin,
        customerId,
        { direction: "CREDIT", amount: BigInt(7_000), reason: "Goodwill" },
        "credit-once",
        CTX,
      ),
    );
    expect(new Set(fulfilled(results).map((r) => r.transactionId)).size).toBe(1);
    expect(fulfilled(results)).toHaveLength(5);
    expect(await db.walletTransaction.count()).toBe(1);
    expect(await wallet(customerId)).toEqual({ balance: 7_000, held: 0 });
  });

  it("never spends the same credit at checkout and in a manual debit", async () => {
    const { customerId, token } = await customer();
    const admin = await owner();
    await fund(customerId, 20_000);
    const variantId = await variant(5);
    await addToCart(variantId, 1, { token });

    const [placed, ...debits] = await Promise.allSettled([
      customerCheckout(token, "wallet-race", 15_000),
      ...[0, 1].map((i) =>
        getWalletService().adjust(
          admin,
          customerId,
          { direction: "DEBIT", amount: BigInt(10_000), reason: "Correction" },
          `race-debit-${i}`,
          CTX,
        ),
      ),
    ]);
    const ordered = placed.status === "fulfilled" && placed.value.status === 201;
    const debited = debits.filter((d) => d.status === "fulfilled").length;
    // Either the order holds 15 000 (no debit fits in the 5 000 left), or
    // a debit ran first and the order no longer fits.
    expect(ordered ? debited === 0 : debited >= 1).toBe(true);
    const after = await wallet(customerId);
    expect(after).toEqual(
      ordered ? { balance: 20_000, held: 15_000 } : { balance: 20_000 - debited * 10_000, held: 0 },
    );
    expect(await db.order.count()).toBe(ordered ? 1 : 0);
  });
});

describe("COD confirmation and expiry", () => {
  async function pendingOrder(token?: string) {
    const variantId = await variant(3);
    let response: Response;
    if (token) {
      await addToCart(variantId, 1, { token });
      response = await customerCheckout(token, `cod-${++counter}`);
    } else {
      const guest = (await addToCart(variantId, 1))!;
      response = await guestCheckout(guest, `cod-${++counter}`);
    }
    const order = await data(response, 201);
    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    return { orderId: order.id as string, variantId, deadline: row.codConfirmationDeadlineAt! };
  }

  it("lets exactly one of a last-minute confirmation and the expiry job win", async () => {
    for (let round = 0; round < 3; round++) {
      const { orderId, variantId, deadline } = await pendingOrder();
      const { token } = await getCodService().issueConfirmationToken(orderId);
      const before = createCodService({
        db,
        clock: fixedClock(new Date(deadline.getTime() - MS_PER_MINUTE)),
      });
      const after = createCodService({
        db,
        clock: fixedClock(new Date(deadline.getTime() + MS_PER_MINUTE)),
      });

      const [confirmed, expired] = await Promise.allSettled([
        before.confirmByLink(orderId, token, null, CTX),
        after.expireOrders(),
      ]);
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(await historyChain(orderId)).toEqual(["PENDING_CONFIRMATION", order.status]);
      if (order.status === "NEW") {
        expect(confirmed.status).toBe("fulfilled");
        expect(expired).toEqual({ status: "fulfilled", value: 0 });
        expect(await stock(variantId)).toEqual({ available: 2, reserved: 1, damaged: 0 });
      } else {
        expect(order.status).toBe("EXPIRED");
        expect(confirmed.status).toBe("rejected");
        expect(code((confirmed as PromiseRejectedResult).reason)).toBe("ORDER_STATE_INVALID");
        expect(await stock(variantId)).toEqual({ available: 3, reserved: 0, damaged: 0 });
      }
    }
  });

  it("expires an order once when the expiry job runs twice at once", async () => {
    const { customerId, token } = await customer();
    await fund(customerId, 1_000);
    const variantId = await variant(3);
    await addToCart(variantId, 1, { token });
    const order = await data(await customerCheckout(token, "expire-twice", 1_000), 201);
    const { codConfirmationDeadlineAt } = await db.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const late = () =>
      createCodService({
        db,
        clock: fixedClock(new Date(codConfirmationDeadlineAt!.getTime() + MS_PER_HOUR)),
      }).expireOrders();

    const counts = fulfilled(await concurrently(3, late));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await historyChain(order.id)).toEqual(["PENDING_CONFIRMATION", "EXPIRED"]);
    expect(await db.outboxEvent.count({ where: { eventType: "ORDER_EXPIRED" } })).toBe(1);
    expect(await stock(variantId)).toEqual({ available: 3, reserved: 0, damaged: 0 });
    expect(await wallet(customerId)).toEqual({ balance: 1_000, held: 0 });
  });
});

describe("concurrent order edits", () => {
  /** A customer order moved to NEW by its COD link confirmation. */
  async function newOrder(walletAmount = 0) {
    const { customerId, token } = await customer();
    if (walletAmount > 0) await fund(customerId, walletAmount);
    const variantId = await variant(5);
    await addToCart(variantId, 1, { token });
    const order = await data(await customerCheckout(token, `new-${++counter}`, walletAmount), 201);
    const { token: link } = await getCodService().issueConfirmationToken(order.id);
    await getCodService().confirmByLink(order.id, link, null, CTX);
    return { customerId, orderId: order.id as string, variantId };
  }

  it("releases holds once when the customer and staff cancel at the same time", async () => {
    const { customerId, orderId, variantId } = await newOrder(2_000);
    const admin = await owner();
    const results = await Promise.allSettled([
      getOrdersService().cancelMyOrder(customerId, orderId, null, "en", CTX),
      getOrdersService().cancelOrder(admin, orderId, "Out of stock call", CTX),
      getOrdersService().cancelMyOrder(customerId, orderId, "again", "en", CTX),
    ]);
    expect(fulfilled(results)).toHaveLength(1);
    expect(rejected(results).map(code)).toEqual([
      "ORDER_CANCELLATION_NOT_ALLOWED",
      "ORDER_CANCELLATION_NOT_ALLOWED",
    ]);
    expect(await historyChain(orderId)).toEqual(["PENDING_CONFIRMATION", "NEW", "CANCELLED"]);
    expect(await db.outboxEvent.count({ where: { eventType: "ORDER_CANCELLED" } })).toBe(1);
    expect(await stock(variantId)).toEqual({ available: 5, reserved: 0, damaged: 0 });
    expect(await wallet(customerId)).toEqual({ balance: 2_000, held: 0 });
  });

  it("keeps one consistent history when staff moves and a cancellation race", async () => {
    const { customerId, orderId, variantId } = await newOrder();
    const admin = await owner();
    const results = await Promise.allSettled([
      getOrdersService().confirmOrder(admin, orderId, CTX),
      getOrdersService().startPreparing(admin, orderId, CTX),
      getOrdersService().cancelMyOrder(customerId, orderId, null, "en", CTX),
    ]);
    for (const error of rejected(results)) {
      expect(code(error)).toBe("ORDER_STATE_INVALID");
    }
    // Cancellation is allowed from NEW, CONFIRMED and PREPARING (R11), so it always lands.
    expect(results[2].status).toBe("fulfilled");
    expect((await historyChain(orderId)).at(-1)).toBe("CANCELLED");
    expect(await stock(variantId)).toEqual({ available: 5, reserved: 0, damaged: 0 });
  });

  it("applies a revision once when it is confirmed twice at once", async () => {
    const { customerId, orderId, variantId } = await newOrder();
    const revision = await getRevisionsService().modify(
      customerId,
      orderId,
      { items: [{ variantId, quantity: 3 }] },
      "en",
      CTX,
    );
    const results = await concurrently(3, () =>
      getRevisionsService().confirm(customerId, orderId, revision.id, "en", CTX),
    );
    expect(fulfilled(results)).toHaveLength(1);
    for (const error of rejected(results)) {
      expect(error).toMatchObject({ details: { reason: "REVISION_CONFIRMED" } });
    }
    expect(await db.orderItem.findMany({ where: { orderId } })).toMatchObject([{ quantity: 3 }]);
    expect(await stock(variantId)).toEqual({ available: 2, reserved: 3, damaged: 0 });
  });

  it("never leaves stock held when a revision races a cancellation", async () => {
    const { customerId, orderId, variantId } = await newOrder();
    const revision = await getRevisionsService().modify(
      customerId,
      orderId,
      { items: [{ variantId, quantity: 4 }] },
      "en",
      CTX,
    );
    const [applied, cancelled] = await Promise.allSettled([
      getRevisionsService().confirm(customerId, orderId, revision.id, "en", CTX),
      getOrdersService().cancelMyOrder(customerId, orderId, null, "en", CTX),
    ]);
    expect(cancelled.status).toBe("fulfilled");
    if (applied.status === "rejected") {
      expect(code(applied.reason)).toBe("ORDER_STATE_INVALID");
    }
    expect((await historyChain(orderId)).at(-1)).toBe("CANCELLED");
    expect(await stock(variantId)).toEqual({ available: 5, reserved: 0, damaged: 0 });
    expect(await db.inventoryReservation.count({ where: { orderId, status: "ACTIVE" } })).toBe(0);
  });
});

describe("purchase receiving", () => {
  async function approvedPurchase(token: string, variantId: string, quantity: number) {
    const supplier = await db.supplier.create({ data: { name: `Supplier ${++counter}` } });
    const po = await data(
      await call(createPurchase, "/admin/purchases", {
        token,
        body: { supplierId: supplier.id, items: [{ variantId, quantity, unitCost: 1000 }] },
      }),
      201,
    );
    return data(
      await call(submitPurchase, `/admin/purchases/${po.id}/submit`, {
        token,
        params: { id: po.id },
      }),
    );
  }

  function receive(token: string, poId: string, itemId: string, quantity: number, key: string) {
    return call(receivePurchase, `/admin/purchases/${poId}/receive`, {
      token,
      params: { id: poId },
      headers: { "idempotency-key": `task062-${key}` },
      body: {
        items: [{ purchaseItemId: itemId, deliveredQuantity: quantity, notes: "Partial delivery" }],
      },
    });
  }

  it("records one receipt when the same receive is retried at once", async () => {
    const admin = await owner();
    const variantId = await variant(0);
    const po = await approvedPurchase(admin.token, variantId, 10);
    const responses = fulfilled(
      await concurrently(4, () => receive(admin.token, po.id, po.items[0].id, 4, "recv-once")),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(await db.goodsReceipt.count()).toBe(1);
    expect(await stock(variantId)).toEqual({ available: 4, reserved: 0, damaged: 0 });
  });

  it("adds up partial deliveries received at the same time", async () => {
    const admin = await owner();
    const variantId = await variant(0);
    const po = await approvedPurchase(admin.token, variantId, 10);
    const responses = fulfilled(
      await concurrently(2, (i) => receive(admin.token, po.id, po.items[0].id, 5, `part-${i}`)),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await db.goodsReceipt.count()).toBe(2);
    expect(await stock(variantId)).toEqual({ available: 10, reserved: 0, damaged: 0 });
    expect(
      (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).weightedAverageCost,
    ).toBe(BigInt(1000));
  });
});
