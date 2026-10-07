import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getCart } from "@/app/api/v1/cart/route";
import { POST as moveToCart } from "@/app/api/v1/me/wishlist/items/[itemId]/move-to-cart/route";
import { DELETE as removeItem } from "@/app/api/v1/me/wishlist/items/[itemId]/route";
import { POST as addItem } from "@/app/api/v1/me/wishlist/items/route";
import { GET as getWishlist } from "@/app/api/v1/me/wishlist/route";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { MAX_WISHLIST_ITEMS } from "@/server/modules/wishlist/wishlist-service";
import { MS_PER_DAY } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of /me/wishlist (TASK-042, API §19, Q4, Q47, Q48, ADR-0041). */

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
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
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

/** A published product with one priced variant holding `stock` units. */
async function variant(stock = 10): Promise<string> {
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
  const id = created.variants[0].id;
  if (stock > 0) {
    await db.inventoryMovement.create({
      data: {
        productVariantId: id,
        movementType: "MANUAL_ADJUSTMENT",
        availableDelta: stock,
        reason: "Test stock",
        createdByType: "SYSTEM",
      },
    });
  }
  return id;
}

/** Archives the variant's product. */
async function archive(variantId: string) {
  await db.product.updateMany({
    where: { variants: { some: { id: variantId } } },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
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

function add(token: string, variantId: string) {
  return call(addItem, "/me/wishlist/items", { method: "POST", token, body: { variantId } });
}

function move(token: string, itemId: string) {
  return call(moveToCart, `/me/wishlist/items/${itemId}/move-to-cart`, {
    method: "POST",
    token,
    params: { itemId },
  });
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

describe("wishlist", () => {
  it("is account-only", async () => {
    await errorOf(await call(getWishlist, "/me/wishlist"), 401);
    await errorOf(
      await call(addItem, "/me/wishlist/items", {
        method: "POST",
        body: { variantId: UNKNOWN_ID },
      }),
      401,
    );
  });

  it("adds once, lists with status and removes", async () => {
    const { token } = await customer();
    expect(await data(await call(getWishlist, "/me/wishlist", { token }))).toEqual({
      id: null,
      items: [],
      itemCount: 0,
    });
    const v = await variant();
    const first = await data(await add(token, v));
    const again = await data(await add(token, v));
    expect(again).toEqual(first);
    expect(first.itemCount).toBe(1);
    expect(first.items[0]).toMatchObject({
      variantId: v,
      name: expect.stringMatching(/^Product /),
      unitPrice: 15000,
      status: "AVAILABLE",
      imageUrl: null,
    });

    const itemId = first.items[0].id as string;
    const after = await data(
      await call(removeItem, `/me/wishlist/items/${itemId}`, {
        method: "DELETE",
        token,
        params: { itemId },
      }),
    );
    expect(after.items).toEqual([]);
    await errorOf(
      await call(removeItem, `/me/wishlist/items/${itemId}`, {
        method: "DELETE",
        token,
        params: { itemId },
      }),
      404,
    );
  });

  it("refuses unknown, unpublished and archived variants and validates input", async () => {
    const { token } = await customer();
    await errorOf(await add(token, UNKNOWN_ID), 404);
    const draft = await variant();
    await db.productVariant.update({
      where: { id: draft },
      data: { product: { update: { status: "DRAFT" } } },
    });
    await errorOf(await add(token, draft), 404);
    const archived = await variant();
    await archive(archived);
    await errorOf(await add(token, archived), 404);
    await errorOf(
      await call(addItem, "/me/wishlist/items", {
        method: "POST",
        token,
        body: { variantId: "x" },
      }),
      400,
    );
  });

  it("keeps out-of-stock (Q47) and archived (Q48) items visible", async () => {
    const { token } = await customer();
    const soldOut = await variant(0);
    const later = await variant();
    await add(token, soldOut);
    await add(token, later);
    await archive(later);

    const list = await data(await call(getWishlist, "/me/wishlist", { token }));
    const byVariant = Object.fromEntries(
      list.items.map((i: { variantId: string }) => [i.variantId, i]),
    );
    expect(byVariant[soldOut]).toMatchObject({ status: "OUT_OF_STOCK", unitPrice: 15000 });
    expect(byVariant[later]).toMatchObject({ status: "UNAVAILABLE", unitPrice: null });
  });

  it("enforces the item limit", async () => {
    const { customerId, token } = await customer();
    const v = await variant();
    const wishlist = await db.wishlist.create({ data: { customerId } });
    const others = await Promise.all(Array.from({ length: MAX_WISHLIST_ITEMS }, () => variant(0)));
    await db.wishlistItem.createMany({
      data: others.map((productVariantId) => ({ wishlistId: wishlist.id, productVariantId })),
    });
    const error = await errorOf(await add(token, v), 409);
    expect(error.details).toMatchObject({ reason: "WISHLIST_LIMIT_REACHED" });
  });

  it("keeps each customer's items private", async () => {
    const owner = await customer();
    const other = await customer();
    const { items } = await data(await add(owner.token, await variant()));
    const itemId = items[0].id as string;
    await errorOf(await move(other.token, itemId), 404);
    await errorOf(
      await call(removeItem, `/me/wishlist/items/${itemId}`, {
        method: "DELETE",
        token: other.token,
        params: { itemId },
      }),
      404,
    );
    expect(
      (await data(await call(getWishlist, "/me/wishlist", { token: owner.token }))).itemCount,
    ).toBe(1);
  });
});

describe("move to cart", () => {
  it("adds one unit to the cart and removes the item", async () => {
    const { token } = await customer();
    const v = await variant();
    const { items } = await data(await add(token, v));

    const moved = await data(await move(token, items[0].id));
    expect(moved.wishlist.items).toEqual([]);
    expect(moved.cart.items).toHaveLength(1);
    expect(moved.cart.items[0]).toMatchObject({ variantId: v, quantity: 1, status: "AVAILABLE" });
    expect((await data(await call(getCart, "/cart", { token }))).id).toBe(moved.cart.id);

    // Already moved: nothing left to move, the cart is unchanged.
    await errorOf(await move(token, items[0].id), 404);

    // Into an existing line: the quantity grows.
    const again = await data(await add(token, v));
    const second = await data(await move(token, again.items[0].id));
    expect(second.cart.items[0].quantity).toBe(2);
  });

  it("changes nothing when the cart refuses the item", async () => {
    const { token } = await customer();
    const soldOut = await variant(0);
    const archived = await variant();
    await add(token, soldOut);
    const { items } = await data(await add(token, archived));
    await archive(archived);
    const byVariant = Object.fromEntries(
      items.map((i: { variantId: string; id: string }) => [i.variantId, i.id]),
    );

    expect((await errorOf(await move(token, byVariant[soldOut]), 422)).code).toBe("OUT_OF_STOCK");
    await errorOf(await move(token, byVariant[archived]), 404);

    expect((await data(await call(getWishlist, "/me/wishlist", { token }))).itemCount).toBe(2);
    expect((await data(await call(getCart, "/cart", { token }))).items).toEqual([]);
  });
});
