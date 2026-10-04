import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PUT as chooseDiscount } from "@/app/api/v1/cart/discount/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { POST as validate } from "@/app/api/v1/checkout/validate/route";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { createSession } from "@/server/modules/auth/sessions";
import { creditWallet } from "@/server/modules/wallet/wallet-service";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Checkout (TASK-029, Q28, Q37–Q40, Q46, C4, R36, R37). */

const db = getDb();
const BASE = "http://localhost/api/v1";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: { method?: string; token?: string; guest?: string; key?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.guest) headers.set("x-guest-cart-token", options.guest);
  if (options.key) headers.set("idempotency-key", `checkout-${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "POST",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve({}) as Promise<never> },
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

async function product(options: { price?: number; stock?: number } = {}) {
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
            sellingPrice: BigInt(options.price ?? 15000),
            weightedAverageCost: BigInt(9000),
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
      availableDelta: options.stock ?? 10,
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

async function employeeId(): Promise<string> {
  counter += 1;
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `staff${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: { create: { displayName: "Staff", employeeLevel: "ADMIN" } },
    },
    include: { employee: true },
  });
  return account.employee!.id;
}

async function add(variantId: string, quantity: number, who: { guest?: string; token?: string }) {
  const cart = await data(
    await call(addItem, "/cart/items", { ...who, body: { variantId, quantity } }),
  );
  return (cart.guestCartToken as string | undefined) ?? who.guest;
}

const ADDRESS = () => ({
  recipientName: "Mona",
  phone: "01012345678",
  areaId,
  street: "9 Road 9",
});
const CONTACT = { fullName: "Mona Adel", phone: "01012345678", email: "mona@example.com" };

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

describe("guest checkout", () => {
  it("validates, then places the order atomically with its snapshots", async () => {
    const { variantId } = await product({ price: 15000, stock: 5 });
    const guest = await add(variantId, 2, {});
    const body = { contact: CONTACT, address: ADDRESS() };

    const quote = await data(await call(validate, "/checkout/validate", { guest, body }));
    expect(quote).toMatchObject({
      subtotal: 30000,
      discountTotal: 0,
      shippingFee: 5000,
      total: 35000,
      walletAmount: 0,
      codAmount: 35000,
      codConfirmationRequired: true,
    });
    expect(await db.order.count()).toBe(0);

    const order = await data(
      await call(checkout, "/checkout", {
        guest,
        key: "k-1",
        body: { ...body, expectedTotal: quote.total },
      }),
      201,
    );
    expect(order).toMatchObject({
      orderNumber: expect.stringMatching(/^BF-\d+$/),
      status: "PENDING_CONFIRMATION",
      total: 35000,
      codAmount: 35000,
      items: [
        { variantId, sku: expect.any(String), quantity: 2, unitPrice: 15000, lineTotal: 30000 },
      ],
    });

    const row = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, statusHistory: true },
    });
    expect(row).toMatchObject({
      customerId: null,
      guestPhone: "+201012345678",
      guestEmail: "mona@example.com",
      locale: "en",
      taxIncluded: true,
    });
    expect(row.shippingAddressSnapshot).toMatchObject({
      street: "9 Road 9",
      area: { nameEn: "Maadi" },
    });
    expect(row.items[0]).toMatchObject({ unitCostAtSale: BigInt(9000) });
    expect(row.statusHistory).toMatchObject([
      { fromStatus: null, toStatus: "PENDING_CONFIRMATION", changedByType: "SYSTEM" },
    ]);
    expect(
      await db.inventoryBalance.findUniqueOrThrow({ where: { productVariantId: variantId } }),
    ).toMatchObject({ availableQuantity: 3, reservedQuantity: 2 });
    expect(await db.inventoryReservation.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.cart.findFirst({ where: { status: "CONVERTED" } })).not.toBeNull();
    expect(await db.outboxEvent.findFirst({ where: { aggregateId: order.id } })).toMatchObject({
      eventType: "ORDER_CREATED",
      status: "PENDING",
    });

    // Snapshots do not follow later product changes (Q46).
    await db.productVariant.update({ where: { id: variantId }, data: { sellingPrice: BigInt(1) } });
    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).unitPrice).toBe(
      BigInt(15000),
    );
  });

  it("is idempotent per key and refuses a reused key with another body", async () => {
    const { variantId } = await product();
    const guest = await add(variantId, 1, {});
    const body = { contact: CONTACT, address: ADDRESS(), expectedTotal: 20000 };

    const first = await data(await call(checkout, "/checkout", { guest, key: "k", body }), 201);
    const again = await data(await call(checkout, "/checkout", { guest, key: "k", body }), 201);
    expect(again.id).toBe(first.id);
    expect(await db.order.count()).toBe(0 + 1);

    const other = await call(checkout, "/checkout", {
      guest,
      key: "k",
      body: { ...body, contact: { ...CONTACT, fullName: "Other" } },
    });
    expect((await errorOf(other, 409)).code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await errorOf(await call(checkout, "/checkout", { guest, body }), 400)).code).toBe(
      "VALIDATION_ERROR",
    );
    // A new key on the converted cart: nothing left to order.
    const empty = await errorOf(await call(checkout, "/checkout", { guest, key: "k2", body }), 409);
    expect(empty.details.reason).toBe("CART_EMPTY");
  });

  it("refuses a total, price or stock that changed, writing nothing", async () => {
    const { variantId } = await product({ price: 15000, stock: 2 });
    const guest = await add(variantId, 2, {});
    const body = { contact: CONTACT, address: ADDRESS() };

    const total = await errorOf(
      await call(checkout, "/checkout", { guest, key: "a", body: { ...body, expectedTotal: 1 } }),
      409,
    );
    expect(total).toMatchObject({
      code: "PRICE_CHANGED",
      details: { reason: "TOTAL_CHANGED", total: 35000 },
    });

    await db.productVariant.update({
      where: { id: variantId },
      data: { sellingPrice: BigInt(16000) },
    });
    const price = await errorOf(
      await call(checkout, "/checkout", {
        guest,
        key: "b",
        body: { ...body, expectedTotal: 37000 },
      }),
      409,
    );
    expect(price.code).toBe("PRICE_CHANGED");
    expect(price.details.items[0]).toMatchObject({ previousUnitPrice: 15000, unitPrice: 16000 });

    await db.productVariant.update({
      where: { id: variantId },
      data: { sellingPrice: BigInt(15000) },
    });
    await db.inventoryMovement.create({
      data: {
        productVariantId: variantId,
        movementType: "MANUAL_ADJUSTMENT",
        availableDelta: -1,
        reason: "Damaged",
        createdByType: "SYSTEM",
      },
    });
    const stock = await errorOf(
      await call(checkout, "/checkout", {
        guest,
        key: "c",
        body: { ...body, expectedTotal: 35000 },
      }),
      409,
    );
    expect(stock.code).toBe("STOCK_CHANGED");
    expect(await db.order.count()).toBe(0);
    expect(await db.checkoutAttempt.count()).toBe(0);
  });

  it("needs contact details, a usable area and a shipping rule", async () => {
    const { variantId } = await product();
    const guest = await add(variantId, 1, {});
    const noContact = await errorOf(
      await call(validate, "/checkout/validate", { guest, body: { address: ADDRESS() } }),
      400,
    );
    expect(noContact.details.issues[0]).toMatchObject({ path: "contact", code: "required" });
    const wallet = await errorOf(
      await call(validate, "/checkout/validate", {
        guest,
        body: { contact: CONTACT, address: ADDRESS(), walletAmount: 100 },
      }),
      400,
    );
    expect(wallet.details.issues[0].code).toBe("sign_in_required");

    await db.shippingRule.updateMany({ data: { status: "INACTIVE" } });
    const noRule = await call(validate, "/checkout/validate", {
      guest,
      body: { contact: CONTACT, address: ADDRESS() },
    });
    expect((await errorOf(noRule, 422)).code).toBe("SHIPPING_UNAVAILABLE");
    expect(
      (
        await errorOf(
          await call(validate, "/checkout/validate", {
            body: { contact: CONTACT, address: ADDRESS() },
          }),
          409,
        )
      ).details.reason,
    ).toBe("CART_EMPTY");
  });

  it("never sells the last unit twice", async () => {
    const { variantId } = await product({ stock: 1 });
    const a = await add(variantId, 1, {});
    const b = await add(variantId, 1, {});
    const body = { contact: CONTACT, address: ADDRESS(), expectedTotal: 20000 };
    const results = await Promise.all([
      call(checkout, "/checkout", { guest: a, key: "x", body }),
      call(checkout, "/checkout", { guest: b, key: "x", body }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.order.count()).toBe(1);
    expect(
      await db.inventoryBalance.findUniqueOrThrow({ where: { productVariantId: variantId } }),
    ).toMatchObject({ availableQuantity: 0, reservedQuantity: 1 });
  });
});

describe("discounts", () => {
  it("allocates the discount to the targeted lines and counts the use", async () => {
    const one = await product({ price: 10000 });
    const two = await product({ price: 5000 });
    const discount = await db.discount.create({
      data: {
        nameAr: "خصم",
        nameEn: "Sale",
        value: 10,
        scope: "TARGETED",
        products: { create: [{ productId: one.productId }] },
        startsAt: new Date(Date.now() - MS_PER_HOUR),
        status: "ACTIVE",
        usageLimitTotal: 1,
        createdByEmployeeId: await employeeId(),
      },
    });
    const guest = await add(one.variantId, 3, {});
    await add(two.variantId, 1, { guest });
    await data(
      await call(chooseDiscount, "/cart/discount", {
        method: "PUT",
        guest,
        body: { discountId: discount.id },
      }),
    );

    // 35000 − 10% of 30000 = 32000, + 5000 shipping.
    const order = await data(
      await call(checkout, "/checkout", {
        guest,
        key: "d",
        body: { contact: CONTACT, address: ADDRESS(), expectedTotal: 37000 },
      }),
      201,
    );
    expect(order).toMatchObject({ subtotal: 35000, discountTotal: 3000, total: 37000 });
    expect(order.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: one.variantId,
          discountAmount: 3000,
          lineTotal: 27000,
        }),
        expect.objectContaining({ variantId: two.variantId, discountAmount: 0, lineTotal: 5000 }),
      ]),
    );
    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({ appliedDiscountId: discount.id });
    expect(row.discountSnapshot).toMatchObject({ percentage: 10, amount: 3000 });
    expect(await db.discountUsage.findUnique({ where: { orderId: order.id } })).toMatchObject({
      discountAmount: BigInt(3000),
    });

    // The only use is taken: the next cart's choice is refused at checkout.
    const next = await add(one.variantId, 1, {});
    await db.cart.updateMany({ where: { status: "ACTIVE" }, data: { discountId: discount.id } });
    const refused = await errorOf(
      await call(checkout, "/checkout", {
        guest: next,
        key: "d2",
        body: { contact: CONTACT, address: ADDRESS(), expectedTotal: 14000 },
      }),
      422,
    );
    expect(refused).toMatchObject({
      code: "DISCOUNT_INVALID",
      details: { reason: "USAGE_LIMIT_REACHED" },
    });
  });
});

describe("customer checkout", () => {
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

  it("uses a saved address and splits wallet and COD (Q167, Q168)", async () => {
    const { customerId, token } = await customer();
    await fund(customerId, 5000);
    const address = await db.customerAddress.create({
      data: {
        customerId,
        recipientName: "Sara",
        phone: "+201011111111",
        areaId,
        street: "Nile St",
      },
    });
    const { variantId } = await product({ price: 15000 });
    await add(variantId, 1, { token });

    const order = await data(
      await call(checkout, "/checkout", {
        token,
        key: "w",
        body: { addressId: address.id, walletAmount: 5000, expectedTotal: 20000 },
      }),
      201,
    );
    expect(order).toMatchObject({
      status: "PENDING_CONFIRMATION",
      walletAmount: 5000,
      codAmount: 15000,
    });
    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({ customerId, guestPhone: null });
    expect(row.customerSnapshot).toMatchObject({ fullName: "Sara", email: expect.any(String) });
    expect(row.shippingAddressSnapshot).toMatchObject({ sourceAddressId: address.id });
    expect(await db.walletReservation.findFirst({ where: { orderId: order.id } })).toMatchObject({
      amount: BigInt(5000),
      status: "ACTIVE",
    });

    // The held credit is gone for the next order.
    await add(variantId, 1, { token });
    const broke = await errorOf(
      await call(validate, "/checkout/validate", {
        token,
        body: { addressId: address.id, walletAmount: 1 },
      }),
      422,
    );
    expect(broke).toMatchObject({ code: "WALLET_INSUFFICIENT_FUNDS", details: { available: 0 } });
  });

  it("starts NEW without COD when the wallet covers the total (C4)", async () => {
    const { customerId, token } = await customer();
    await fund(customerId, 50000);
    const { variantId } = await product({ price: 15000 });
    await add(variantId, 1, { token });
    const above = await errorOf(
      await call(validate, "/checkout/validate", {
        token,
        body: { address: ADDRESS(), walletAmount: 20001 },
      }),
      400,
    );
    expect(above.details.issues[0].code).toBe("above_total");
    const order = await data(
      await call(checkout, "/checkout", {
        token,
        key: "full",
        body: { address: ADDRESS(), walletAmount: 20000, expectedTotal: 20000 },
      }),
      201,
    );
    expect(order).toMatchObject({ status: "NEW", codAmount: 0, codConfirmationRequired: false });
    expect(
      await db.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id } }),
    ).toMatchObject({ toStatus: "NEW", changedByType: "CUSTOMER", reason: "WALLET_COVERS_TOTAL" });
  });

  it("refuses another customer's address and keeps history append-only", async () => {
    const other = await customer();
    const theirs = await db.customerAddress.create({
      data: {
        customerId: other.customerId,
        recipientName: "X",
        phone: "+201011111111",
        areaId,
        street: "S",
      },
    });
    const { token } = await customer();
    const { variantId } = await product();
    await add(variantId, 1, { token });
    const res = await call(validate, "/checkout/validate", {
      token,
      body: { addressId: theirs.id },
    });
    expect((await errorOf(res, 404)).code).toBe("NOT_FOUND");

    const order = await data(
      await call(checkout, "/checkout", {
        token,
        key: "h",
        body: { address: ADDRESS(), expectedTotal: 20000 },
      }),
      201,
    );
    await expect(
      db.orderStatusHistory.updateMany({
        where: { orderId: order.id },
        data: { reason: "edited" },
      }),
    ).rejects.toThrow(/append-only/);
  });
});
