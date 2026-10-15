import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as funnel } from "@/app/api/v1/admin/analytics/funnel/route";
import { GET as overview } from "@/app/api/v1/admin/analytics/overview/route";
import { GET as products } from "@/app/api/v1/admin/analytics/products/route";
import { GET as profit } from "@/app/api/v1/admin/analytics/profit/route";
import type { OrderStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Analytics aggregation and profit metrics (TASK-051, Q149, Q150, ADR-0052). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const ANON = "0192f000-0000-7000-8000-000000000051";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function get(handler: unknown, path: string, token?: string, status = 200) {
  const headers = new Headers({ "accept-language": "en" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await (handler as Handler)(new Request(`${BASE}${path}`, { headers }), {
    params: Promise.resolve({}) as Promise<never>,
  });
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json;
}

let counter = 0;

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
  });
  const session = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return session.tokens.accessToken;
}

async function product(name: string, cost: number | null) {
  counter += 1;
  const created = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: name,
      slug: `p-${counter}`,
      status: "PUBLISHED",
      firstPublishedAt: new Date(),
      variants: {
        create: [
          {
            sku: `SKU-${counter}`,
            isDefault: true,
            sellingPrice: BigInt(15000),
            weightedAverageCost: cost === null ? null : BigInt(cost),
          },
        ],
      },
    },
    include: { variants: true },
  });
  return { productId: created.id, variantId: created.variants[0].id };
}

async function order(
  status: OrderStatus,
  line: { productId: string; variantId: string; quantity: number; unitPrice: number },
  options: { customerId?: string; cost?: number | null; shipping?: number; at?: Date } = {},
) {
  counter += 1;
  const at = options.at ?? new Date();
  const lineTotal = BigInt(line.unitPrice * line.quantity);
  const shipping = BigInt(options.shipping ?? 0);
  await db.order.create({
    data: {
      orderNumber: `BF-A${counter}`,
      customerId: options.customerId ?? null,
      guestPhone: options.customerId ? null : "+201000000000",
      status,
      locale: "en",
      subtotal: lineTotal,
      discountTotal: BigInt(0),
      shippingFee: shipping,
      total: lineTotal + shipping,
      walletAmountReserved: BigInt(0),
      codAmount: lineTotal + shipping,
      shippingRuleSnapshot: {},
      shippingAddressSnapshot: {},
      customerSnapshot: {},
      createdAt: at,
      updatedAt: at,
      items: {
        create: [
          {
            productId: line.productId,
            productVariantId: line.variantId,
            skuSnapshot: "SKU",
            productNameSnapshot: { ar: "منتج", en: "Product" },
            unitPrice: BigInt(line.unitPrice),
            unitCostAtSale: options.cost == null ? null : BigInt(options.cost),
            quantity: line.quantity,
            discountAmount: BigInt(0),
            lineTotal,
            createdAt: at,
          },
        ],
      },
    },
  });
}

function event(
  eventType: "PRODUCT_VIEW" | "ADD_TO_CART" | "CHECKOUT_STARTED" | "ORDER_CREATED",
  entityId: string,
  who: { anonymousId?: string; customerId?: string },
) {
  return db.analyticsEvent.create({
    data: {
      eventType,
      anonymousId: who.anonymousId ?? null,
      customerId: who.customerId ?? null,
      entityType:
        { PRODUCT_VIEW: "PRODUCT", ADD_TO_CART: "PRODUCT" }[eventType as string] ?? "CART",
      entityId,
      occurredAt: new Date(),
    },
  });
}

let viewer: string;
let profitViewer: string;
let a: { productId: string; variantId: string };
let b: { productId: string; variantId: string };

beforeEach(async () => {
  await resetDatabase();
  viewer = await staff(["ANALYTICS_VIEW"]);
  profitViewer = await staff(["ANALYTICS_VIEW", "VIEW_PROFIT"]);
  a = await product("Serum", 9000);
  b = await product("Lipstick", null);
  const customer = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: "buyer@example.com",
      passwordHash: "unused",
      status: "ACTIVE",
      customer: { create: { phone: "+201011111111", fullName: "Sara" } },
    },
    include: { customer: true },
  });
  const customerId = customer.customer!.id;

  // Revenue orders today: 2 × 150.00 (cost 90.00) + shipping 50.00; 1 × 200.00 without cost.
  await order(
    "CONFIRMED",
    { ...a, quantity: 2, unitPrice: 15000 },
    { customerId, cost: 9000, shipping: 5000 },
  );
  await order("DELIVERED", { ...b, quantity: 1, unitPrice: 20000 });
  // Not revenue (REVENUE_ORDER_STATUSES, owner decision 2026-10-15).
  await order("NEW", { ...a, quantity: 1, unitPrice: 15000 }, { cost: 9000 });
  await order("CANCELLED", { ...a, quantity: 1, unitPrice: 15000 }, { cost: 9000 });
  await order("PENDING_CONFIRMATION", { ...a, quantity: 1, unitPrice: 15000 }, { cost: 9000 });
  // Three days ago: only in 7D.
  await order(
    "CONFIRMED",
    { ...a, quantity: 1, unitPrice: 15000 },
    { cost: 9000, at: new Date(Date.now() - 3 * MS_PER_DAY) },
  );

  await event("PRODUCT_VIEW", a.productId, { anonymousId: ANON });
  await event("PRODUCT_VIEW", a.productId, { customerId });
  await event("ADD_TO_CART", a.productId, { anonymousId: ANON });
  await event("CHECKOUT_STARTED", ANON, { anonymousId: ANON });
  await event("ORDER_CREATED", ANON, { anonymousId: ANON });
});

afterAll(async () => {
  await resetDatabase();
});

describe("authorization and validation", () => {
  it("needs a staff session and ANALYTICS_VIEW; profit needs VIEW_PROFIT", async () => {
    await get(overview, "/admin/analytics/overview", undefined, 401);
    const none = await staff([]);
    const denied = await get(overview, "/admin/analytics/overview", none, 403);
    expect(denied.error.code).toBe("PERMISSION_DENIED");
    await get(funnel, "/admin/analytics/funnel", none, 403);
    await get(products, "/admin/analytics/products", none, 403);
    await get(profit, "/admin/analytics/profit", viewer, 403);
  });

  it("rejects bad ranges", async () => {
    for (const q of ["range=WEEK", "range=CUSTOM", "range=CUSTOM&from=2026-02-01&to=2026-01-01"]) {
      const res = await get(overview, `/admin/analytics/overview?${q}`, viewer, 400);
      expect(res.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("overview", () => {
  it("counts revenue orders and hides costs without VIEW_PROFIT", async () => {
    const { data } = await get(overview, "/admin/analytics/overview?range=TODAY", viewer);
    expect(data.period.range).toBe("TODAY");
    expect(data.period.timeZone).toBe("Africa/Cairo");
    expect(data.orders).toEqual({
      count: 2,
      byStatus: { CONFIRMED: 1, NEW: 1, DELIVERED: 1, CANCELLED: 1, PENDING_CONFIRMATION: 1 },
    });
    expect(data.revenue).toBe(50000);
    expect(data.shippingFees).toBe(5000);
    expect(data.averageOrderValue).toBe(25000);
    expect(data.customers).toEqual({ new: 1, ordering: 1, guestOrders: 1 });
    expect(data.visitors).toBe(2);
    expect(data.productViews).toEqual({ visitors: 2, events: 2 });
    expect(data.daily).toEqual([{ date: data.period.to, orders: 2, revenue: 50000 }]);
    expect(data).not.toHaveProperty("cogs");
    expect(data).not.toHaveProperty("estimatedGrossProfit");
  });

  it("adds COGS and estimated gross profit with VIEW_PROFIT", async () => {
    const { data } = await get(overview, "/admin/analytics/overview?range=TODAY", profitViewer);
    expect(data).toMatchObject({
      revenue: 50000,
      cogs: 18000,
      // Costed revenue 300.00 − COGS 180.00; the 200.00 line has no cost.
      estimatedGrossProfit: 12000,
      revenueWithoutCost: 20000,
      linesWithoutCost: 1,
    });
  });

  it("covers 7 days with a zero-filled daily series", async () => {
    const { data } = await get(overview, "/admin/analytics/overview?range=7D", viewer);
    expect(data.orders.count).toBe(3);
    expect(data.revenue).toBe(65000);
    expect(data.daily).toHaveLength(7);
    expect(data.daily.reduce((n: number, d: { orders: number }) => n + d.orders, 0)).toBe(3);
  });
});

describe("funnel, products, profit", () => {
  it("reports visitors and events per step", async () => {
    const { data } = await get(funnel, "/admin/analytics/funnel?range=TODAY", viewer);
    expect(data).toMatchObject({
      visitors: 2,
      productViews: { visitors: 2, events: 2 },
      addToCart: { visitors: 1, events: 1 },
      checkoutStarted: { visitors: 1, events: 1 },
      checkoutAbandoned: { visitors: 0, events: 0 },
      orderCreated: { visitors: 1, events: 1 },
      ordersDelivered: 1,
    });
  });

  it("ranks products by revenue with engagement", async () => {
    const res = await get(products, "/admin/analytics/products?range=TODAY", viewer);
    expect(res.meta.pagination).toEqual({ page: 1, pageSize: 24, total: 2, totalPages: 1 });
    expect(res.data.items).toEqual([
      {
        productId: a.productId,
        name: { ar: "منتج", en: "Serum" },
        views: 2,
        addToCart: 1,
        unitsSold: 2,
        revenue: 30000,
      },
      {
        productId: b.productId,
        name: { ar: "منتج", en: "Lipstick" },
        views: 0,
        addToCart: 0,
        unitsSold: 1,
        revenue: 20000,
      },
    ]);
    const costed = await get(products, "/admin/analytics/products?range=TODAY", profitViewer);
    expect(costed.data.items[0]).toMatchObject({ cogs: 18000, estimatedGrossProfit: 12000 });
    expect(costed.data.items[1]).toMatchObject({ estimatedGrossProfit: 0, linesWithoutCost: 1 });
  });

  it("reports profit to VIEW_PROFIT holders", async () => {
    const { data } = await get(profit, "/admin/analytics/profit?range=TODAY", profitViewer);
    expect(data).toMatchObject({
      orders: 2,
      revenue: 50000,
      cogs: 18000,
      estimatedGrossProfit: 12000,
      revenueWithoutCost: 20000,
    });
    expect(data.daily).toHaveLength(1);
  });
});
