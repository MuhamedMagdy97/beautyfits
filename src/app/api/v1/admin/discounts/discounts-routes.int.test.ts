import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as activate } from "@/app/api/v1/admin/discounts/[id]/activate/route";
import { POST as deactivate } from "@/app/api/v1/admin/discounts/[id]/deactivate/route";
import { PATCH as patchDiscount } from "@/app/api/v1/admin/discounts/[id]/route";
import { GET as listDiscounts, POST as createDiscount } from "@/app/api/v1/admin/discounts/route";
import { DELETE as removeDiscount, PUT as chooseDiscount } from "@/app/api/v1/cart/discount/route";
import { DELETE as removeItem } from "@/app/api/v1/cart/items/[cartItemId]/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as merge } from "@/app/api/v1/cart/merge/route";
import { POST as reprice } from "@/app/api/v1/cart/reprice/route";
import { GET as getCart } from "@/app/api/v1/cart/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { createSession } from "@/server/modules/auth/sessions";
import {
  recordDiscountUsage,
  releaseDiscountUsage,
} from "@/server/modules/discounts/discounts-service";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";
import { bareOrder, bareOrders } from "@/test/integration/orders";

/** Admin discounts (API §23) and discounts in the cart (TASK-026, Q125, Q131–Q138, R36). */

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
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.guest) headers.set("x-guest-cart-token", options.guest);
  if (options.body !== undefined) headers.set("content-type", "application/json");
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

/** A published product with one priced variant in stock. */
async function product(price: number, extra: { brandId?: string; categoryId?: string } = {}) {
  counter += 1;
  const created = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      status: "PUBLISHED",
      firstPublishedAt: new Date(),
      brandId: extra.brandId,
      variants: { create: { sku: `SKU-${counter}`, isDefault: true, sellingPrice: BigInt(price) } },
      categories: extra.categoryId ? { create: { categoryId: extra.categoryId } } : undefined,
    },
    include: { variants: true },
  });
  await db.inventoryMovement.create({
    data: {
      productVariantId: created.variants[0].id,
      movementType: "MANUAL_ADJUSTMENT",
      availableDelta: 20,
      reason: "Test stock",
      createdByType: "SYSTEM",
    },
  });
  return { productId: created.id, variantId: created.variants[0].id };
}

let manager: { employeeId: string; token: string };

const HOUR_AGO = () => new Date(Date.now() - MS_PER_HOUR).toISOString();

function discountBody(overrides: Record<string, unknown> = {}) {
  return {
    nameAr: "خصم",
    nameEn: "Autumn sale",
    value: 20,
    scope: "STORE_WIDE",
    startsAt: HOUR_AGO(),
    ...overrides,
  };
}

/** Creates (and by default activates) a discount; returns its view. */
async function discount(overrides: Record<string, unknown> = {}, active = true) {
  const created = await data(
    await call(createDiscount, "/admin/discounts", {
      method: "POST",
      token: manager.token,
      body: discountBody(overrides),
    }),
    201,
  );
  if (!active) return created;
  return data(
    await call(activate, `/admin/discounts/${created.id}/activate`, {
      method: "POST",
      token: manager.token,
      params: { id: created.id },
    }),
  );
}

async function guestCartWith(variantId: string, quantity = 1, guest?: string) {
  const cart = await data(
    await call(addItem, "/cart/items", { method: "POST", guest, body: { variantId, quantity } }),
  );
  return { guest: (cart.guestCartToken as string | undefined) ?? guest!, cart };
}

function choose(owner: { guest?: string; token?: string }, body: unknown) {
  return call(chooseDiscount, "/cart/discount", { method: "PUT", body, ...owner });
}

beforeEach(async () => {
  await resetDatabase();
  manager = await staff("MANAGER", ["DISCOUNT_VIEW", "DISCOUNT_MANAGE"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("admin discounts", () => {
  it("needs the discount permissions", async () => {
    const viewer = await staff("EMPLOYEE", ["DISCOUNT_VIEW"]);
    expect((await call(listDiscounts, "/admin/discounts")).status).toBe(401);
    expect((await call(listDiscounts, "/admin/discounts", { token: viewer.token })).status).toBe(
      200,
    );
    const res = await call(createDiscount, "/admin/discounts", {
      method: "POST",
      token: viewer.token,
      body: discountBody(),
    });
    expect((await errorOf(res, 403)).code).toBe("PERMISSION_DENIED");
  });

  it("creates inactive discounts, audited, with uppercase unique codes", async () => {
    const created = await discount({ code: "autumn-20", maxDiscountAmount: 5000 }, false);
    expect(created).toMatchObject({
      code: "AUTUMN-20",
      status: "INACTIVE",
      type: "PERCENTAGE",
      value: 20,
      scope: "STORE_WIDE",
      maxDiscountAmount: 5000,
      minimumOrderTotal: null,
      endsAt: null,
      usedCount: 0,
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "DISCOUNT_CREATED" } });
    expect(audit).toMatchObject({ entityType: "DISCOUNT", entityId: created.id });

    const duplicate = await call(createDiscount, "/admin/discounts", {
      method: "POST",
      token: manager.token,
      body: discountBody({ code: "Autumn-20" }),
    });
    expect(await errorOf(duplicate, 409)).toMatchObject({ details: { reason: "CODE_TAKEN" } });
  });

  it("validates targets, period and percentage", async () => {
    const { productId } = await product(10_000);
    const cases: [Record<string, unknown>, string][] = [
      [{ productIds: [productId] }, "scope"],
      [{ scope: "TARGETED" }, "scope"],
      [{ scope: "TARGETED", productIds: [UNKNOWN_ID] }, "productIds"],
      [{ scope: "TARGETED", brandIds: [UNKNOWN_ID] }, "brandIds"],
      [{ endsAt: HOUR_AGO(), startsAt: new Date().toISOString() }, "endsAt"],
      [{ value: 0 }, "value"],
      [{ value: 101 }, "value"],
      [{ value: 12.5 }, "value"],
      [{ code: "a b" }, "code"],
    ];
    for (const [overrides, path] of cases) {
      const res = await call(createDiscount, "/admin/discounts", {
        method: "POST",
        token: manager.token,
        body: discountBody(overrides),
      });
      const error = await errorOf(res, 400);
      expect(error.details.issues[0].path, JSON.stringify(overrides)).toBe(path);
    }
  });

  it("edits, replaces targets, activates and deactivates (audited, idempotent)", async () => {
    const brand = await db.brand.create({ data: { nameAr: "ب", nameEn: "B", slug: "b" } });
    const created = await discount({}, false);
    const params = { id: created.id };
    const edited = await data(
      await call(patchDiscount, `/admin/discounts/${created.id}`, {
        method: "PATCH",
        token: manager.token,
        params,
        body: { scope: "TARGETED", brandIds: [brand.id], value: 30 },
      }),
    );
    expect(edited).toMatchObject({ scope: "TARGETED", brandIds: [brand.id], value: 30 });
    const back = await call(patchDiscount, `/admin/discounts/${created.id}`, {
      method: "PATCH",
      token: manager.token,
      params,
      body: { scope: "STORE_WIDE" },
    });
    expect((await errorOf(back, 400)).details.issues[0].code).toBe("targets_not_allowed");

    for (const handler of [activate, activate, deactivate, deactivate]) {
      await data(await call(handler, "/x", { method: "POST", token: manager.token, params }));
    }
    const actions = await db.auditLog.findMany({
      where: { entityId: created.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "DISCOUNT_CREATED",
      "DISCOUNT_UPDATED",
      "DISCOUNT_ACTIVATED",
      "DISCOUNT_DEACTIVATED",
    ]);
    const missing = await call(activate, "/x", {
      method: "POST",
      token: manager.token,
      params: { id: UNKNOWN_ID },
    });
    expect(missing.status).toBe(404);
  });

  it("lists with status and search filters and usage counts", async () => {
    const used = await discount({ code: "WELCOME" });
    await discount({ nameEn: "Hidden offer" }, false);
    const orderId = await bareOrder();
    await runInTransaction(
      (tx) =>
        recordDiscountUsage(tx, {
          discountId: used.id,
          orderId,
          customerId: null,
          discountAmount: BigInt(100),
          now: new Date(),
        }),
      {},
      db,
    );
    const active = await data(
      await call(listDiscounts, "/admin/discounts?status=ACTIVE", { token: manager.token }),
    );
    expect(active).toEqual([expect.objectContaining({ code: "WELCOME", usedCount: 1 })]);
    const found = await data(
      await call(listDiscounts, "/admin/discounts?search=hidden", { token: manager.token }),
    );
    expect(found.map((d: { nameEn: string }) => d.nameEn)).toEqual(["Hidden offer"]);
  });
});

describe("discounts in the cart", () => {
  it("lists codeless offers without applying them, until the shopper chooses (Q138)", async () => {
    const { variantId } = await product(10_000);
    const offer = await discount({ value: 15 });
    await discount({ code: "SECRET" }); // coded: never listed
    await discount({ nameEn: "Off" }, false); // inactive: never listed
    const { guest } = await guestCartWith(variantId, 2);

    const cart = await data(await call(getCart, "/cart", { guest }));
    expect(cart).toMatchObject({
      subtotal: 20_000,
      discount: null,
      discountTotal: 0,
      total: 20_000,
      requiresReview: false,
    });
    expect(cart.availableDiscounts).toEqual([
      {
        id: offer.id,
        name: "Autumn sale",
        percentage: 15,
        amount: 3000,
        maxDiscountAmount: null,
        minimumOrderTotal: null,
        endsAt: null,
      },
    ]);

    const chosen = await data(await choose({ guest }, { discountId: offer.id }));
    expect(chosen).toMatchObject({
      discount: { id: offer.id, code: null, percentage: 15, amount: 3000 },
      discountTotal: 3000,
      total: 17_000,
    });
    const removed = await data(
      await call(removeDiscount, "/cart/discount", { method: "DELETE", guest }),
    );
    expect(removed).toMatchObject({ discount: null, total: 20_000 });
  });

  it("accepts a code in any case, never a coded discount by id, and throttles wrong codes", async () => {
    const { variantId } = await product(10_000);
    const coded = await discount({ code: "WELCOME10", value: 10 });
    const { guest } = await guestCartWith(variantId);

    expect((await data(await choose({ guest }, { code: "welcome10" }))).discount).toMatchObject({
      code: "WELCOME10",
      amount: 1000,
    });
    expect(await errorOf(await choose({ guest }, { discountId: coded.id }), 422)).toMatchObject({
      code: "DISCOUNT_INVALID",
      details: { reason: "NOT_FOUND" },
    });
    expect((await errorOf(await choose({ guest }, { code: "NOPE1" }), 422)).details.reason).toBe(
      "NOT_FOUND",
    );
    expect(
      (await errorOf(await choose({ guest }, { code: "x", discountId: coded.id }), 400)).code,
    ).toBe("VALIDATION_ERROR");

    for (let i = 0; i < 19; i += 1) {
      await choose({ guest }, { code: `WRONG${i}` });
    }
    expect((await errorOf(await choose({ guest }, { code: "WELCOME10" }), 429)).code).toBe(
      "RATE_LIMITED",
    );
  });

  it("targets products, brands and categories with their subcategories", async () => {
    const brand = await db.brand.create({ data: { nameAr: "ب", nameEn: "B", slug: "brand" } });
    const skin = await db.category.create({ data: { nameAr: "ع", nameEn: "Skin", slug: "skin" } });
    const serum = await db.category.create({
      data: { nameAr: "س", nameEn: "Serum", slug: "serum", parentId: skin.id },
    });
    const inSub = await product(10_000, { categoryId: serum.id });
    const branded = await product(20_000, { brandId: brand.id });
    const named = await product(30_000);
    const other = await product(40_000);
    const { guest } = await guestCartWith(inSub.variantId);
    for (const p of [branded, named, other]) await guestCartWith(p.variantId, 1, guest);

    const byCategory = await discount({ scope: "TARGETED", categoryIds: [skin.id], value: 10 });
    const byBrand = await discount({ scope: "TARGETED", brandIds: [brand.id], value: 10 });
    const byProduct = await discount({
      scope: "TARGETED",
      productIds: [named.productId],
      value: 10,
    });
    const amounts = Object.fromEntries(
      (await data(await call(getCart, "/cart", { guest }))).availableDiscounts.map(
        (d: { id: string; amount: number }) => [d.id, d.amount],
      ),
    );
    expect(amounts).toEqual({ [byCategory.id]: 1000, [byBrand.id]: 2000, [byProduct.id]: 3000 });
  });

  it("refuses discounts that do not apply, with the reason", async () => {
    const { variantId } = await product(10_000);
    const { guest } = await guestCartWith(variantId);
    const minimum = await discount({ minimumOrderTotal: 50_000 });
    const ended = await discount({
      startsAt: new Date(Date.now() - 2 * MS_PER_HOUR).toISOString(),
      endsAt: HOUR_AGO(),
    });
    const later = await discount({ startsAt: new Date(Date.now() + MS_PER_HOUR).toISOString() });
    const inactive = await discount({}, false);

    expect(
      (await errorOf(await choose({ guest }, { discountId: minimum.id }), 422)).details.reason,
    ).toBe("MINIMUM_NOT_MET");
    expect((await errorOf(await choose({ guest }, { discountId: ended.id }), 422)).code).toBe(
      "DISCOUNT_EXPIRED",
    );
    for (const d of [later, inactive]) {
      expect((await errorOf(await choose({ guest }, { discountId: d.id }), 422)).code).toBe(
        "DISCOUNT_INVALID",
      );
    }
    expect((await errorOf(await choose({}, { discountId: minimum.id }), 422)).details.reason).toBe(
      "NO_ELIGIBLE_ITEMS",
    );
  });

  it("rechecks the chosen discount on every read and drops it on reprice (Q38)", async () => {
    const cheap = await product(10_000);
    const dear = await product(40_000);
    const offer = await discount({ minimumOrderTotal: 45_000, value: 10 });
    const { guest } = await guestCartWith(cheap.variantId);
    const { cart } = await guestCartWith(dear.variantId, 1, guest);
    await data(await choose({ guest }, { discountId: offer.id }));

    const dearLine = cart.items.find((i: { variantId: string }) => i.variantId === dear.variantId);
    const after = await data(
      await call(removeItem, "/x", {
        method: "DELETE",
        guest,
        params: { cartItemId: dearLine.id },
      }),
    );
    expect(after).toMatchObject({
      discount: null,
      discountProblem: { discountId: offer.id, reason: "MINIMUM_NOT_MET" },
      total: 10_000,
      requiresReview: true,
    });

    const repriced = await data(await call(reprice, "/cart/reprice", { method: "POST", guest }));
    expect(repriced).toMatchObject({
      discountRemoved: { discountId: offer.id, reason: "MINIMUM_NOT_MET" },
      discountProblem: null,
      requiresReview: false,
    });

    // Deactivating a chosen discount shows it as a problem too.
    const other = await discount({ value: 5 });
    await data(await choose({ guest }, { discountId: other.id }));
    await call(deactivate, "/x", {
      method: "POST",
      token: manager.token,
      params: { id: other.id },
    });
    expect((await data(await call(getCart, "/cart", { guest }))).discountProblem.reason).toBe(
      "INACTIVE",
    );
  });

  it("enforces per-customer and overall limits, giving uses back on release (R36)", async () => {
    const { variantId } = await product(10_000);
    const once = await discount({ code: "ONCE", usageLimitPerCustomer: 1 });
    const { guest } = await guestCartWith(variantId);
    expect((await errorOf(await choose({ guest }, { code: "ONCE" }), 422)).details.reason).toBe(
      "SIGN_IN_REQUIRED",
    );

    const { token, customerId } = await customer();
    await call(addItem, "/cart/items", { method: "POST", token, body: { variantId, quantity: 1 } });
    await data(await choose({ token }, { code: "ONCE" }));

    const orderId = await bareOrder();
    const use = (id: string, who: string | null) =>
      runInTransaction(
        (tx) =>
          recordDiscountUsage(tx, {
            discountId: once.id,
            orderId: id,
            customerId: who,
            discountAmount: BigInt(2000),
            now: new Date(),
          }),
        {},
        db,
      );
    await use(orderId, customerId);
    expect((await data(await call(getCart, "/cart", { token }))).discountProblem.reason).toBe(
      "CUSTOMER_LIMIT_REACHED",
    );
    await expect(use(await bareOrder(), customerId)).rejects.toMatchObject({
      code: "DISCOUNT_INVALID",
    });

    await runInTransaction((tx) => releaseDiscountUsage(tx, orderId, new Date()), {}, db);
    await runInTransaction((tx) => releaseDiscountUsage(tx, orderId, new Date()), {}, db);
    expect((await data(await call(getCart, "/cart", { token }))).discount.code).toBe("ONCE");
  });

  it("never lets concurrent orders pass the overall limit", async () => {
    const limited = await discount({ usageLimitTotal: 1 });
    const orders = await bareOrders(3);
    const results = await Promise.allSettled(
      orders.map((orderId) =>
        runInTransaction(
          (tx) =>
            recordDiscountUsage(tx, {
              discountId: limited.id,
              orderId,
              customerId: null,
              discountAmount: BigInt(100),
              now: new Date(),
            }),
          {},
          db,
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.discountUsage.count()).toBe(1);
  });

  it("carries the guest's choice into the customer's cart on merge unless they chose one", async () => {
    const { variantId } = await product(10_000);
    const offer = await discount();
    const { guest } = await guestCartWith(variantId);
    await data(await choose({ guest }, { discountId: offer.id }));
    const { token } = await customer();
    await call(addItem, "/cart/items", { method: "POST", token, body: { variantId, quantity: 1 } });

    const merged = await data(await call(merge, "/cart/merge", { method: "POST", token, guest }));
    expect(merged.discount.id).toBe(offer.id);
  });
});
