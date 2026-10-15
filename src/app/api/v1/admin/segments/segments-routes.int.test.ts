import { beforeEach, describe, expect, it } from "vitest";
import { POST as preview } from "@/app/api/v1/admin/segments/preview/route";
import type { MarketingChannel, OrderStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { segmentCustomerIds } from "@/server/modules/customers/segments";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Customer segments (TASK-047, Q140, Q141, ADR-0057). */

const db = getDb();
const URL = "http://localhost/api/v1/admin/segments/preview";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function post(body: unknown, token?: string, status = 200) {
  const headers = new Headers({ "accept-language": "en", "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await (preview as Handler)(
    new Request(URL, { method: "POST", headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) as Promise<never> },
  );
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

/** A customer with consent rows in order (`true` = opted in). */
async function customer(consents: [MarketingChannel, boolean][], anonymized = false) {
  counter += 1;
  const created = await db.customer.create({
    data: {
      phone: `+20101000${String(counter).padStart(4, "0")}`,
      fullName: `Customer ${counter}`,
      anonymizedAt: anonymized ? new Date() : null,
    },
  });
  for (const [channel, optedIn] of consents) {
    await db.marketingConsent.create({
      data: {
        customerId: created.id,
        channel,
        status: optedIn ? "OPTED_IN" : "OPTED_OUT",
        source: "CUSTOMER_ACCOUNT",
        occurredAt: new Date(),
      },
    });
  }
  return created.id;
}

async function product(options: { brandId?: string; categoryId?: string } = {}) {
  counter += 1;
  const created = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `p-${counter}`,
      firstPublishedAt: new Date(),
      status: "PUBLISHED",
      brand: options.brandId ? { connect: { id: options.brandId } } : undefined,
      variants: { create: [{ sku: `SKU-${counter}`, isDefault: true }] },
      categories: options.categoryId ? { create: [{ categoryId: options.categoryId }] } : undefined,
    },
    include: { variants: true },
  });
  return { productId: created.id, variantId: created.variants[0].id };
}

async function order(
  customerId: string,
  status: OrderStatus,
  line: { productId: string; variantId: string },
  lineTotal: number,
  at = new Date(),
) {
  counter += 1;
  const total = BigInt(lineTotal);
  await db.order.create({
    data: {
      orderNumber: `BF-S${counter}`,
      customerId,
      status,
      locale: "en",
      subtotal: total,
      discountTotal: BigInt(0),
      // Shipping is not spend: it must not reach the HIGH_SPENDING total.
      shippingFee: BigInt(7000),
      total: total + BigInt(7000),
      walletAmountReserved: BigInt(0),
      codAmount: total + BigInt(7000),
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
            unitPrice: total,
            quantity: 1,
            discountAmount: BigInt(0),
            lineTotal: total,
            createdAt: at,
          },
        ],
      },
    },
  });
}

let viewer: string;
let ids: Record<string, string>;
let p1: { productId: string; variantId: string };
let brandId: string;
let parentCategoryId: string;

beforeEach(async () => {
  await resetDatabase();
  viewer = await staff(["MARKETING_VIEW"]);
  brandId = (await db.brand.create({ data: { nameAr: "ب", nameEn: "Brand", slug: "brand" } })).id;
  parentCategoryId = (
    await db.category.create({ data: { nameAr: "ف", nameEn: "Face", slug: "face" } })
  ).id;
  const child = await db.category.create({
    data: { nameAr: "س", nameEn: "Serums", slug: "serums", parentId: parentCategoryId },
  });
  p1 = await product({ brandId, categoryId: child.id });
  const p2 = await product();

  ids = {
    alice: await customer([["EMAIL", true]]),
    bob: await customer([["EMAIL", true]]),
    carol: await customer([
      ["EMAIL", true],
      ["EMAIL", false],
    ]),
    dave: await customer([["WHATSAPP", true]]),
    erin: await customer([["EMAIL", true]]),
    frank: await customer([["EMAIL", true]]),
    gina: await customer([["EMAIL", true]], true),
  };
  await order(ids.alice, "DELIVERED", p1, 30000);
  await order(ids.bob, "CONFIRMED", p2, 50000, new Date(Date.now() - 100 * MS_PER_DAY));
  await order(ids.carol, "DELIVERED", p1, 90000);
  await order(ids.dave, "DELIVERED", p1, 90000);
  await order(ids.frank, "CANCELLED", p1, 90000);
  await order(ids.frank, "PENDING_CONFIRMATION", p1, 90000);
  await order(ids.gina, "DELIVERED", p1, 90000);
});

async function count(body: Record<string, unknown>) {
  const json = await post({ channel: "EMAIL", ...body }, viewer);
  return json.data.customerCount as number;
}

describe("POST /admin/segments/preview", () => {
  it("requires a staff session with MARKETING_VIEW", async () => {
    await post({ type: "ALL_OPTED_IN", channel: "EMAIL" }, undefined, 401);
    const other = await staff(["CUSTOMER_VIEW", "ANALYTICS_VIEW"]);
    await post({ type: "ALL_OPTED_IN", channel: "EMAIL" }, other, 403);
  });

  it("validates the definition", async () => {
    const json = await post({ type: "INACTIVE", channel: "EMAIL" }, viewer, 400);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    await post({ type: "HIGH_SPENDING", channel: "EMAIL", minSpent: 100.5 }, viewer, 400);
  });

  it("counts only customers currently opted in to the channel", async () => {
    const json = await post({ type: "ALL_OPTED_IN", channel: "EMAIL" }, viewer);
    // carol opted out, dave has WhatsApp only, gina is anonymized.
    expect(json.data).toEqual({
      segment: { type: "ALL_OPTED_IN", channel: "EMAIL" },
      customerCount: 4,
    });
    expect(await count({ type: "ALL_OPTED_IN", channel: "WHATSAPP" })).toBe(1);
    expect(
      (await segmentCustomerIds(db, { type: "ALL_OPTED_IN", channel: "EMAIL" }, new Date())).sort(),
    ).toEqual([ids.alice, ids.bob, ids.erin, ids.frank].sort());
  });

  it("finds buyers by orders in buying statuses", async () => {
    // frank's orders are cancelled / unconfirmed: not a buyer.
    expect(
      (
        await segmentCustomerIds(db, { type: "PREVIOUS_BUYERS", channel: "EMAIL" }, new Date())
      ).sort(),
    ).toEqual([ids.alice, ids.bob].sort());
    expect(await count({ type: "PRODUCT_BUYERS", productIds: [p1.productId] })).toBe(1);
    expect(await count({ type: "BRAND_BUYERS", brandIds: [brandId] })).toBe(1);
    // The parent category covers products of its subcategories.
    expect(await count({ type: "CATEGORY_BUYERS", categoryIds: [parentCategoryId] })).toBe(1);
    expect(
      await count({ type: "PRODUCT_BUYERS", productIds: ["019a0000-0000-7000-8000-000000000999"] }),
    ).toBe(0);
  });

  it("finds buyers with no buying order in the last N days", async () => {
    expect(
      await segmentCustomerIds(
        db,
        { type: "INACTIVE", channel: "EMAIL", inactiveDays: 30 },
        new Date(),
      ),
    ).toEqual([ids.bob]);
    expect(await count({ type: "INACTIVE", inactiveDays: 120 })).toBe(0);
  });

  it("compares lifetime spend in piastres, shipping excluded", async () => {
    expect(await count({ type: "HIGH_SPENDING", minSpent: 30000 })).toBe(2);
    expect(await count({ type: "HIGH_SPENDING", minSpent: 50000 })).toBe(1);
    // bob paid 570.00 with shipping, but merchandise is 500.00.
    expect(await count({ type: "HIGH_SPENDING", minSpent: 50001 })).toBe(0);
  });
});
