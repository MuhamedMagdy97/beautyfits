import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DELETE as removeItem,
  PATCH as patchItem,
} from "@/app/api/v1/cart/items/[cartItemId]/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as merge } from "@/app/api/v1/cart/merge/route";
import { POST as reprice } from "@/app/api/v1/cart/reprice/route";
import { GET as getCart } from "@/app/api/v1/cart/route";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { getCartService, MAX_CART_LINES } from "@/server/modules/cart/cart-service";
import { SETTING_KEYS } from "@/server/modules/settings/settings";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of /cart (TASK-025, API §14, Q37, R33, ADR-0031). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    token?: string;
    guest?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.guest) {
    headers.set("x-guest-cart-token", options.guest);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "GET",
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

/** A published product whose variants have a price and `stock` units each. */
async function product(options: { stock?: number; price?: bigint | null; variants?: number } = {}) {
  counter += 1;
  const n = options.variants ?? 1;
  const created = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      status: "PUBLISHED",
      firstPublishedAt: new Date(),
      variants: {
        create: Array.from({ length: n }, (_, i) => ({
          sku: `SKU-${counter}-${i}`,
          isDefault: i === 0,
          variantNameAr: n > 1 ? `لون ${i}` : null,
          variantNameEn: n > 1 ? `Shade ${i}` : null,
          sellingPrice: options.price === undefined ? BigInt(15000) : options.price,
        })),
      },
    },
    include: { variants: { orderBy: { sku: "asc" } } },
  });
  for (const variant of created.variants) {
    await setStock(variant.id, options.stock ?? 10);
  }
  return { product: created, variantIds: created.variants.map((v) => v.id) };
}

async function setStock(variantId: string, quantity: number) {
  const balance = await db.inventoryBalance.findUniqueOrThrow({
    where: { productVariantId: variantId },
  });
  const delta = quantity - balance.availableQuantity;
  if (delta !== 0) {
    await db.inventoryMovement.create({
      data: {
        productVariantId: variantId,
        movementType: "MANUAL_ADJUSTMENT",
        availableDelta: delta,
        reason: "Test stock",
        createdByType: "SYSTEM",
      },
    });
  }
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

/** Adds as a guest; returns the token (new or given) and the cart. */
async function guestAdd(variantId: string, quantity: number, guest?: string) {
  const cart = await data(
    await call(addItem, "/cart/items", { method: "POST", guest, body: { variantId, quantity } }),
  );
  return { guest: (cart.guestCartToken as string | undefined) ?? guest!, cart };
}

beforeAll(() => {
  counter = 0;
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("guest cart", () => {
  it("is empty without a token and returns a token on the first write only", async () => {
    expect(await data(await call(getCart, "/cart"))).toMatchObject({
      id: null,
      items: [],
      subtotal: 0,
      requiresReview: false,
    });
    const { variantIds } = await product({ price: BigInt(12550) });

    const first = await guestAdd(variantIds[0], 2);
    expect(first.guest).toMatch(/^bfc_/);
    expect(first.cart).toMatchObject({ itemCount: 2, subtotal: 25100, currency: "EGP" });

    const second = await guestAdd(variantIds[0], 1, first.guest);
    expect(second.cart.guestCartToken).toBeUndefined();
    expect(second.cart.items).toHaveLength(1);
    expect(second.cart.items[0]).toMatchObject({
      variantId: variantIds[0],
      name: expect.stringMatching(/^Product /),
      quantity: 3,
      unitPrice: 12550,
      lastSeenUnitPrice: 12550,
      lineTotal: 37650,
      priceChanged: false,
      status: "AVAILABLE",
      imageUrl: null,
    });

    const read = await data(await call(getCart, "/cart", { guest: first.guest }));
    expect(read.id).toBe(second.cart.id);
    // Only the hash of the token is stored.
    const row = await db.cart.findUniqueOrThrow({ where: { id: read.id } });
    expect(row.guestTokenHash).not.toContain(first.guest);
  });

  it("starts a new cart for an unknown token", async () => {
    const { variantIds } = await product();
    const unknown = `bfc_${"A".repeat(43)}`;
    expect((await data(await call(getCart, "/cart", { guest: unknown }))).id).toBeNull();
    const { guest } = await guestAdd(variantIds[0], 1, unknown);
    expect(guest).not.toBe(unknown);
  });

  it("refuses variants that cannot be bought", async () => {
    const { product: draft, variantIds: draftIds } = await product();
    await db.product.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    const { variantIds: archived } = await product({ variants: 2 });
    await db.productVariant.update({
      where: { id: archived[1] },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    const { variantIds: unpriced } = await product({ price: null });

    for (const variantId of [draftIds[0], archived[1], unpriced[0], UNKNOWN_ID]) {
      const res = await call(addItem, "/cart/items", {
        method: "POST",
        body: { variantId, quantity: 1 },
      });
      expect((await errorOf(res, 404)).code).toBe("NOT_FOUND");
    }
    expect(await db.cart.count()).toBe(0); // a refused first write creates no cart
  });

  it("refuses more than the available stock, counting what is already in the cart", async () => {
    const { variantIds } = await product({ stock: 3 });
    const tooMany = await call(addItem, "/cart/items", {
      method: "POST",
      body: { variantId: variantIds[0], quantity: 4 },
    });
    expect(await errorOf(tooMany, 422)).toMatchObject({
      code: "OUT_OF_STOCK",
      details: { variantId: variantIds[0], availableQuantity: 3 },
    });

    const { guest } = await guestAdd(variantIds[0], 2);
    const res = await call(addItem, "/cart/items", {
      method: "POST",
      guest,
      body: { variantId: variantIds[0], quantity: 2 },
    });
    expect((await errorOf(res, 422)).code).toBe("OUT_OF_STOCK");
  });

  it("validates input", async () => {
    for (const body of [
      { variantId: "nope", quantity: 1 },
      { variantId: UNKNOWN_ID, quantity: 0 },
      { variantId: UNKNOWN_ID, quantity: 1000 },
      { variantId: UNKNOWN_ID, quantity: 1.5 },
    ]) {
      const res = await call(addItem, "/cart/items", { method: "POST", body });
      expect((await errorOf(res, 400)).code).toBe("VALIDATION_ERROR");
    }
  });

  it("limits the number of different items", async () => {
    const { variantIds } = await product({ variants: MAX_CART_LINES + 1, stock: 5 });
    const { guest, cart } = await guestAdd(variantIds[0], 1);
    await db.cartItem.createMany({
      data: variantIds.slice(1, MAX_CART_LINES).map((productVariantId) => ({
        cartId: cart.id,
        productVariantId,
        quantity: 1,
        lastSeenUnitPrice: BigInt(15000),
      })),
    });
    const res = await call(addItem, "/cart/items", {
      method: "POST",
      guest,
      body: { variantId: variantIds[MAX_CART_LINES], quantity: 1 },
    });
    expect(await errorOf(res, 409)).toMatchObject({
      code: "CONFLICT",
      details: { reason: "CART_LINE_LIMIT_REACHED" },
    });
    // More of an item already in the cart is still fine.
    await guestAdd(variantIds[0], 1, guest);
  });

  it("rate limits new guest carts per IP", async () => {
    const { variantIds } = await product();
    const now = new Date();
    await db.rateLimitBucket.create({
      data: {
        key: "cart:create:ip:unknown",
        count: 30,
        windowStartedAt: now,
        blockedUntil: new Date(now.getTime() + MS_PER_HOUR),
        updatedAt: now,
      },
    });
    const res = await call(addItem, "/cart/items", {
      method: "POST",
      body: { variantId: variantIds[0], quantity: 1 },
    });
    expect((await errorOf(res, 429)).code).toBe("RATE_LIMITED");
  });
});

describe("cart items", () => {
  it("changes quantities: lowering always works, raising needs stock", async () => {
    const { variantIds } = await product({ stock: 5 });
    const { guest, cart } = await guestAdd(variantIds[0], 4);
    const itemId = cart.items[0].id;
    const params = { cartItemId: itemId };

    const raised = await call(patchItem, `/cart/items/${itemId}`, {
      method: "PATCH",
      guest,
      params,
      body: { quantity: 6 },
    });
    expect(await errorOf(raised, 422)).toMatchObject({ details: { availableQuantity: 5 } });

    await setStock(variantIds[0], 2);
    const shown = await data(await call(getCart, "/cart", { guest }));
    expect(shown.items[0]).toMatchObject({ status: "INSUFFICIENT_STOCK", availableQuantity: 2 });
    expect(shown.requiresReview).toBe(true);

    const lowered = await data(
      await call(patchItem, `/cart/items/${itemId}`, {
        method: "PATCH",
        guest,
        params,
        body: { quantity: 3 },
      }),
    );
    expect(lowered.items[0]).toMatchObject({ quantity: 3, status: "INSUFFICIENT_STOCK" });
  });

  it("switches to another variant of the same product, folding lines together", async () => {
    const { variantIds } = await product({ variants: 3, stock: 5 });
    const { variantIds: other } = await product();
    const { guest, cart } = await guestAdd(variantIds[0], 2);
    await guestAdd(variantIds[2], 1, guest);
    const itemId = cart.items[0].id;
    const params = { cartItemId: itemId };
    const patch = (body: unknown) =>
      call(patchItem, `/cart/items/${itemId}`, { method: "PATCH", guest, params, body });

    expect((await errorOf(await patch({ variantId: other[0] }), 400)).code).toBe(
      "VALIDATION_ERROR",
    );
    expect((await errorOf(await patch({}), 400)).code).toBe("VALIDATION_ERROR");

    const switched = await data(await patch({ variantId: variantIds[1], quantity: 3 }));
    expect(switched.items.map((i: { variantId: string }) => i.variantId)).toEqual([
      variantIds[1],
      variantIds[2],
    ]);
    expect(switched.items[0]).toMatchObject({ id: itemId, quantity: 3, variantName: "Shade 1" });

    // Switching onto a variant already in the cart: 3 + 1 > nothing short, folded into one line.
    const folded = await data(await patch({ variantId: variantIds[2] }));
    expect(folded.items).toHaveLength(1);
    expect(folded.items[0]).toMatchObject({ variantId: variantIds[2], quantity: 4 });
  });

  it("removes lines and keeps carts apart", async () => {
    const { variantIds } = await product();
    const a = await guestAdd(variantIds[0], 1);
    const b = await guestAdd(variantIds[0], 1);
    const { token } = await customer();
    const itemId = a.cart.items[0].id;
    const params = { cartItemId: itemId };

    for (const owner of [{ guest: b.guest }, { token }, {}]) {
      const res = await call(removeItem, `/cart/items/${itemId}`, {
        method: "DELETE",
        params,
        ...owner,
      });
      expect((await errorOf(res, 404)).code).toBe("NOT_FOUND");
    }
    const malformed = await call(removeItem, "/cart/items/x", {
      method: "DELETE",
      guest: a.guest,
      params: { cartItemId: "x" },
    });
    expect(malformed.status).toBe(404);

    const after = await data(
      await call(removeItem, `/cart/items/${itemId}`, { method: "DELETE", guest: a.guest, params }),
    );
    expect(after).toMatchObject({ id: a.cart.id, items: [], subtotal: 0 });
  });
});

describe("prices and availability", () => {
  it("flags a changed price until it is accepted with reprice (Q37)", async () => {
    const { variantIds } = await product({ price: BigInt(10000) });
    const { guest, cart } = await guestAdd(variantIds[0], 2);
    await db.productVariant.update({
      where: { id: variantIds[0] },
      data: { sellingPrice: BigInt(11000) },
    });

    const changed = await data(await call(getCart, "/cart", { guest }));
    expect(changed.items[0]).toMatchObject({
      unitPrice: 11000,
      lastSeenUnitPrice: 10000,
      priceChanged: true,
      lineTotal: 22000,
    });
    expect(changed).toMatchObject({ subtotal: 22000, requiresReview: true });

    const repriced = await data(await call(reprice, "/cart/reprice", { method: "POST", guest }));
    expect(repriced.changes).toEqual([
      { cartItemId: cart.items[0].id, previousUnitPrice: 10000, unitPrice: 11000 },
    ]);
    expect(repriced.items[0]).toMatchObject({ lastSeenUnitPrice: 11000, priceChanged: false });
    expect(repriced.requiresReview).toBe(false);

    const again = await data(await call(reprice, "/cart/reprice", { method: "POST", guest }));
    expect(again.changes).toEqual([]);
    expect((await data(await call(reprice, "/cart/reprice", { method: "POST" }))).id).toBeNull();
  });

  it("keeps lines that stop being purchasable, marked unavailable", async () => {
    const { product: p, variantIds } = await product({ price: BigInt(10000) });
    const { variantIds: kept } = await product({ price: BigInt(5000) });
    const { guest } = await guestAdd(variantIds[0], 1);
    await guestAdd(kept[0], 1, guest);
    await db.product.update({ where: { id: p.id }, data: { status: "DISABLED" } });

    const cart = await data(await call(getCart, "/cart", { guest }));
    expect(cart.items[0]).toMatchObject({
      status: "UNAVAILABLE",
      unitPrice: null,
      lineTotal: null,
      priceChanged: false,
    });
    expect(cart).toMatchObject({ subtotal: 5000, itemCount: 2, requiresReview: true });

    const repriced = await data(await call(reprice, "/cart/reprice", { method: "POST", guest }));
    expect(repriced.changes).toEqual([]);
  });
});

describe("customer cart", () => {
  it("uses the signed-in customer's cart, never the guest one", async () => {
    const { variantIds } = await product();
    const { guest } = await guestAdd(variantIds[0], 1);
    const { token } = await customer();

    expect((await data(await call(getCart, "/cart", { token, guest }))).id).toBeNull();
    const cart = await data(
      await call(addItem, "/cart/items", {
        method: "POST",
        token,
        guest,
        body: { variantId: variantIds[0], quantity: 2 },
      }),
    );
    expect(cart.guestCartToken).toBeUndefined();
    expect((await data(await call(getCart, "/cart", { token }))).id).toBe(cart.id);

    const bad = await call(getCart, "/cart", { token: "bfa_nope", guest });
    expect((await errorOf(bad, 401)).code).toBe("UNAUTHENTICATED");
  });

  it("creates one active cart under concurrent first writes", async () => {
    const { variantIds } = await product({ variants: 2 });
    const { token, customerId } = await customer();
    await Promise.all(
      variantIds.map((variantId) =>
        call(addItem, "/cart/items", { method: "POST", token, body: { variantId, quantity: 1 } }),
      ),
    );
    const carts = await db.cart.findMany({ where: { customerId }, include: { items: true } });
    expect(carts).toHaveLength(1);
    expect(carts[0].items).toHaveLength(2);
  });
});

describe("expiry (R35)", () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * MS_PER_DAY);

  it("forgets guest carts unchanged for 30 days and the sweep marks them expired", async () => {
    const { variantIds } = await product();
    const old = await guestAdd(variantIds[0], 1);
    const fresh = await guestAdd(variantIds[0], 1);
    const { token, customerId } = await customer();
    await call(addItem, "/cart/items", {
      method: "POST",
      token,
      body: { variantId: variantIds[0], quantity: 1 },
    });
    await db.cart.update({ where: { id: old.cart.id }, data: { updatedAt: daysAgo(30) } });
    await db.cart.update({ where: { id: fresh.cart.id }, data: { updatedAt: daysAgo(29) } });
    await db.cart.updateMany({ where: { customerId }, data: { updatedAt: daysAgo(400) } });

    expect((await data(await call(getCart, "/cart", { guest: old.guest }))).id).toBeNull();
    expect((await data(await call(getCart, "/cart", { guest: fresh.guest }))).id).toBe(
      fresh.cart.id,
    );
    expect((await data(await call(getCart, "/cart", { token }))).items).toHaveLength(1);
    // An expired guest cart is not merged.
    const merged = await data(
      await call(merge, "/cart/merge", { method: "POST", token, guest: old.guest }),
    );
    expect(merged.itemCount).toBe(1);
    // Writing with its token starts a new cart.
    const restarted = await guestAdd(variantIds[0], 1, old.guest);
    expect(restarted.guest).not.toBe(old.guest);

    expect(await getCartService().expireGuestCarts()).toBe(1);
    const statuses = await db.cart.findMany({ select: { id: true, status: true } });
    expect(statuses.find((c) => c.id === old.cart.id)?.status).toBe("EXPIRED");
    expect(statuses.filter((c) => c.status === "ACTIVE")).toHaveLength(3);
    expect(await getCartService().expireGuestCarts()).toBe(0);
  });

  it("follows the configured number of days", async () => {
    const { variantIds } = await product();
    const { guest, cart } = await guestAdd(variantIds[0], 1);
    await db.setting.create({
      data: { key: SETTING_KEYS.cartGuestExpiryDays, valueJson: 7, dataType: "INTEGER" },
    });
    await db.cart.update({ where: { id: cart.id }, data: { updatedAt: daysAgo(8) } });
    expect((await data(await call(getCart, "/cart", { guest }))).id).toBeNull();
  });
});

describe("merge after login (R33)", () => {
  it("adopts the guest cart when the customer has none", async () => {
    const { variantIds } = await product();
    const { guest, cart } = await guestAdd(variantIds[0], 2);
    const { token } = await customer();

    const merged = await data(await call(merge, "/cart/merge", { method: "POST", token, guest }));
    expect(merged).toMatchObject({ id: cart.id, itemCount: 2 });
    expect((await data(await call(getCart, "/cart", { guest }))).id).toBeNull();
    expect((await data(await call(getCart, "/cart", { token }))).id).toBe(cart.id);
  });

  it("adds quantities capped at the stock, never below the customer's own", async () => {
    const { variantIds: capped } = await product({ stock: 4 });
    const { variantIds: short } = await product({ stock: 5 });
    const { variantIds: guestOnly } = await product({ stock: 5 });
    const { variantIds: ownOnly } = await product({ stock: 5 });
    const { token } = await customer();
    const add = (variantId: string, quantity: number) =>
      call(addItem, "/cart/items", { method: "POST", token, body: { variantId, quantity } });

    await add(capped[0], 2);
    await add(short[0], 3);
    await add(ownOnly[0], 1);
    const { guest, cart: guestCart } = await guestAdd(capped[0], 3);
    await guestAdd(short[0], 2, guest);
    await guestAdd(guestOnly[0], 5, guest);
    await setStock(short[0], 1);
    await setStock(guestOnly[0], 2);

    const merged = await data(await call(merge, "/cart/merge", { method: "POST", token, guest }));
    const quantities = Object.fromEntries(
      merged.items.map((i: { variantId: string; quantity: number }) => [i.variantId, i.quantity]),
    );
    expect(quantities).toEqual({
      [capped[0]]: 4, // 2 + 3, capped at 4
      [short[0]]: 3, // 3 + 2 capped at 1, but never below the customer's 3
      [ownOnly[0]]: 1,
      [guestOnly[0]]: 5, // kept as it was, shown as short of stock
    });
    expect((await db.cart.findUniqueOrThrow({ where: { id: guestCart.id } })).status).toBe(
      "MERGED",
    );

    // A retry changes nothing.
    const retried = await data(await call(merge, "/cart/merge", { method: "POST", token, guest }));
    expect(retried.items).toEqual(merged.items);
  });

  it("needs a customer session and tolerates a missing token", async () => {
    const { guest } = await guestAdd((await product()).variantIds[0], 1);
    expect(
      (await errorOf(await call(merge, "/cart/merge", { method: "POST", guest }), 401)).code,
    ).toBe("UNAUTHENTICATED");
    const { token } = await customer();
    expect((await data(await call(merge, "/cart/merge", { method: "POST", token }))).id).toBeNull();
  });
});
