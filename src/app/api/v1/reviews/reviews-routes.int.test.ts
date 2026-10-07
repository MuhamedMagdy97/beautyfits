import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as hide } from "@/app/api/v1/admin/reviews/[reviewId]/hide/route";
import { POST as restore } from "@/app/api/v1/admin/reviews/[reviewId]/restore/route";
import { GET as adminReviews } from "@/app/api/v1/admin/reviews/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { POST as validate } from "@/app/api/v1/checkout/validate/route";
import { POST as createReview } from "@/app/api/v1/orders/[orderId]/items/[orderItemId]/review/route";
import { GET as productReviews } from "@/app/api/v1/products/[productId]/reviews/route";
import { POST as report } from "@/app/api/v1/reviews/[reviewId]/report/route";
import { PATCH as editReview } from "@/app/api/v1/reviews/[reviewId]/route";
import type { OrderStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Verified reviews (TASK-044, Q11, Q12, Q49, Q50, Q171–Q174). */

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
let areaId: string;

/** A published product with two shades. */
async function product() {
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
            sku: `SKU-${counter}-A`,
            isDefault: true,
            variantNameAr: "وردي",
            variantNameEn: "Rose",
            sellingPrice: BigInt(15000),
          },
          {
            sku: `SKU-${counter}-B`,
            variantNameAr: "نود",
            variantNameEn: "Nude",
            sellingPrice: BigInt(15000),
          },
        ],
      },
    },
    include: { variants: { orderBy: { sku: "asc" } } },
  });
  for (const variant of created.variants) {
    await db.inventoryMovement.create({
      data: {
        productVariantId: variant.id,
        movementType: "MANUAL_ADJUSTMENT",
        availableDelta: 20,
        reason: "Test stock",
        createdByType: "SYSTEM",
      },
    });
  }
  return { productId: created.id, variantIds: created.variants.map((v) => v.id) };
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

const ADDRESS = () => ({ recipientName: "Mona", phone: "01012345678", areaId, street: "9 Road 9" });

/**
 * Places an order of `variantIds` (customer when `token` is given, else a
 * guest) and sets its status directly: delivery comes with TASK-034.
 */
async function order(variantIds: string[], status: OrderStatus, token?: string) {
  counter += 1;
  let guest: string | undefined;
  for (const variantId of variantIds) {
    const added = await data(
      await call(addItem, "/cart/items", {
        method: "POST",
        token,
        guest,
        body: { variantId, quantity: 1 },
      }),
    );
    guest = token ? undefined : ((added.guestCartToken as string | undefined) ?? guest);
  }
  const who = { token, guest };
  const body = token
    ? { address: ADDRESS() }
    : { contact: { fullName: "Guest", phone: "01198765432" }, address: ADDRESS() };
  const quote = await data(
    await call(validate, "/checkout/validate", { method: "POST", ...who, body }),
  );
  const placed = await data(
    await call(checkout, "/checkout", {
      method: "POST",
      ...who,
      key: `r-${counter}`,
      body: { ...body, expectedTotal: quote.total },
    }),
    201,
  );
  await db.order.update({ where: { id: placed.id }, data: { status } });
  const items = await db.orderItem.findMany({
    where: { orderId: placed.id },
    orderBy: { skuSnapshot: "asc" },
  });
  return { orderId: placed.id as string, itemIds: items.map((i) => i.id) };
}

function review(
  token: string | undefined,
  orderId: string,
  orderItemId: string,
  body: unknown = { rating: 5, body: "Lovely shade." },
) {
  return call(createReview, `/orders/${orderId}/items/${orderItemId}/review`, {
    method: "POST",
    token,
    body,
    params: { orderId, orderItemId },
  });
}

function publicList(productId: string) {
  return call(productReviews, `/products/${productId}/reviews`, { params: { productId } });
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

describe("creating reviews", () => {
  it("publishes one review per delivered order and product, shown at product level", async () => {
    const { productId, variantIds } = await product();
    const sara = await customer();
    // Both shades in one order: one review for the product (Q12, Q49).
    const first = await order(variantIds, "DELIVERED", sara.token);

    const created = await data(await review(sara.token, first.orderId, first.itemIds[0]), 201);
    expect(created).toMatchObject({
      orderId: first.orderId,
      orderItemId: first.itemIds[0],
      productId,
      variantId: variantIds[0],
      rating: 5,
      body: "Lovely shade.",
      status: "PUBLISHED",
    });

    const again = await errorOf(await review(sara.token, first.orderId, first.itemIds[1]), 409);
    expect(again).toMatchObject({ code: "CONFLICT", details: { reviewId: created.id } });

    // A later delivered order may review the same product again.
    const second = await order([variantIds[1]], "DELIVERED", sara.token);
    await data(
      await review(sara.token, second.orderId, second.itemIds[0], { rating: 3, body: "  Ok.  " }),
      201,
    );

    const res = await publicList(productId);
    const listed = await res.json();
    expect(res.status).toBe(200);
    expect(listed.data.summary).toEqual({ reviewCount: 2, averageRating: 4 });
    expect(listed.data.items).toEqual([
      expect.objectContaining({
        rating: 3,
        body: "Ok.",
        variantName: "Nude",
        verifiedPurchase: true,
      }),
      expect.objectContaining({ id: created.id, rating: 5, variantName: "Rose" }),
    ]);
    expect(listed.data.items[0]).not.toHaveProperty("customerId");
    expect(listed.meta.pagination).toMatchObject({ page: 1, total: 2 });

    const audit = await db.auditLog.findMany({ where: { action: "REVIEW_CREATED" } });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actorType: "CUSTOMER", actorId: sara.customerId });
  });

  it("needs the customer's own delivered order", async () => {
    const { productId, variantIds } = await product();
    const sara = await customer();
    const other = await customer();
    const shipped = await order([variantIds[0]], "SHIPPED", sara.token);
    const delivered = await order([variantIds[0]], "DELIVERED", sara.token);
    const guest = await order([variantIds[0]], "DELIVERED");

    const notYet = await errorOf(
      await review(sara.token, shipped.orderId, shipped.itemIds[0]),
      409,
    );
    expect(notYet).toMatchObject({
      code: "ORDER_STATE_INVALID",
      details: { status: "SHIPPED", required: "DELIVERED" },
    });
    for (const [token, target] of [
      [other.token, delivered],
      [sara.token, guest],
    ] as const) {
      const res = await review(token, target.orderId, target.itemIds[0]);
      expect((await errorOf(res, 404)).code).toBe("NOT_FOUND");
    }
    // An item of another order.
    const res = await review(sara.token, delivered.orderId, shipped.itemIds[0]);
    expect((await errorOf(res, 404)).code).toBe("NOT_FOUND");
    expect((await review(undefined, delivered.orderId, delivered.itemIds[0])).status).toBe(401);

    for (const body of [
      { rating: 0, body: "x" },
      { rating: 6, body: "x" },
      { rating: 4.5, body: "x" },
      { rating: 4, body: "   " },
      { rating: 4 },
      { rating: 4, body: "x".repeat(2001) },
    ]) {
      const bad = await review(sara.token, delivered.orderId, delivered.itemIds[0], body);
      expect((await errorOf(bad, 400)).code).toBe("VALIDATION_ERROR");
    }
    expect(await db.review.count()).toBe(0);
    expect((await (await publicList(productId)).json()).data.summary).toEqual({
      reviewCount: 0,
      averageRating: null,
    });
  });

  it("shows no reviews of an unpublished or unknown product", async () => {
    const { productId } = await product();
    await db.product.update({ where: { id: productId }, data: { status: "DISABLED" } });
    expect((await errorOf(await publicList(productId), 404)).code).toBe("NOT_FOUND");
    expect((await errorOf(await publicList(UNKNOWN_ID), 404)).code).toBe("NOT_FOUND");
    expect((await errorOf(await publicList("nope"), 404)).code).toBe("NOT_FOUND");
  });
});

describe("editing and reporting", () => {
  it("lets only the author edit, re-checked without approval (Q50)", async () => {
    const { variantIds } = await product();
    const sara = await customer();
    const other = await customer();
    const placed = await order([variantIds[0]], "DELIVERED", sara.token);
    const created = await data(await review(sara.token, placed.orderId, placed.itemIds[0]), 201);
    const edit = (token: string, body: unknown) =>
      call(editReview, `/reviews/${created.id}`, {
        method: "PATCH",
        token,
        body,
        params: { reviewId: created.id },
      });

    const edited = await data(await edit(sara.token, { rating: 2 }));
    expect(edited).toMatchObject({ rating: 2, body: "Lovely shade.", status: "PUBLISHED" });
    expect((await errorOf(await edit(sara.token, {}), 400)).code).toBe("VALIDATION_ERROR");
    expect((await errorOf(await edit(sara.token, { rating: 9 }), 400)).code).toBe(
      "VALIDATION_ERROR",
    );
    expect((await errorOf(await edit(other.token, { rating: 5 }), 404)).code).toBe("NOT_FOUND");

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "REVIEW_UPDATED" } });
    expect(audit.previousDataJson).toEqual({ rating: 5, body: "Lovely shade." });
    expect(audit.newDataJson).toEqual({ rating: 2, body: "Lovely shade." });
  });

  it("records one report per customer and only for published reviews", async () => {
    const { variantIds } = await product();
    const sara = await customer();
    const other = await customer();
    const placed = await order([variantIds[0]], "DELIVERED", sara.token);
    const created = await data(await review(sara.token, placed.orderId, placed.itemIds[0]), 201);
    const send = (token: string | undefined, body?: unknown) =>
      call(report, `/reviews/${created.id}/report`, {
        method: "POST",
        token,
        body,
        params: { reviewId: created.id },
      });

    expect(await data(await send(other.token, { reason: "Spam" }))).toEqual({
      reviewId: created.id,
    });
    await data(await send(other.token)); // repeating answers the same
    expect(await db.reviewReport.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: "REVIEW_REPORTED" } })).toBe(1);
    expect((await send(undefined)).status).toBe(401);

    await db.review.update({ where: { id: created.id }, data: { status: "HIDDEN" } });
    expect((await errorOf(await send(sara.token), 404)).code).toBe("NOT_FOUND");
  });
});

describe("moderation", () => {
  it("hides and restores with history and audit, never deleting (Q174)", async () => {
    const { productId, variantIds } = await product();
    const sara = await customer();
    const other = await customer();
    const moderator = await staff(["REVIEW_MODERATE"]);
    const outsider = await staff(["ORDERS_VIEW"]);
    const placed = await order([variantIds[0]], "DELIVERED", sara.token);
    const created = await data(await review(sara.token, placed.orderId, placed.itemIds[0]), 201);
    await call(report, `/reviews/${created.id}/report`, {
      method: "POST",
      token: other.token,
      body: { reason: "Rude" },
      params: { reviewId: created.id },
    });
    const params = { reviewId: created.id };
    const hideIt = (token: string, body: unknown) =>
      call(hide, `/admin/reviews/${created.id}/hide`, { method: "POST", token, body, params });

    expect(
      (await errorOf(await call(adminReviews, "/admin/reviews", { token: outsider.token }), 403))
        .code,
    ).toBe("PERMISSION_DENIED");
    const reported = await call(adminReviews, "/admin/reviews?reported=true", {
      token: moderator.token,
    });
    const reportedBody = await reported.json();
    expect(reportedBody.data).toHaveLength(1);
    expect(reportedBody.data[0]).toMatchObject({
      id: created.id,
      customerId: sara.customerId,
      openReportCount: 1,
      reports: [{ customerId: other.customerId, reason: "Rude", resolvedAt: null }],
    });

    expect((await errorOf(await hideIt(moderator.token, {}), 400)).code).toBe("VALIDATION_ERROR");
    expect((await errorOf(await hideIt(outsider.token, { reason: "x" }), 403)).code).toBe(
      "PERMISSION_DENIED",
    );
    const hidden = await data(await hideIt(moderator.token, { reason: "Offensive" }));
    expect(hidden).toMatchObject({
      status: "HIDDEN",
      moderationReason: "Offensive",
      openReportCount: 0,
      moderationHistory: [
        {
          fromStatus: "PUBLISHED",
          toStatus: "HIDDEN",
          employeeId: moderator.employeeId,
          reason: "Offensive",
        },
      ],
    });
    expect((await errorOf(await hideIt(moderator.token, { reason: "Again" }), 409)).code).toBe(
      "CONFLICT",
    );
    expect((await (await publicList(productId)).json()).data.summary.reviewCount).toBe(0);

    // The author's edit keeps it hidden.
    const edited = await data(
      await call(editReview, `/reviews/${created.id}`, {
        method: "PATCH",
        token: sara.token,
        body: { body: "Changed my words." },
        params,
      }),
    );
    expect(edited.status).toBe("HIDDEN");

    const restored = await data(
      await call(restore, `/admin/reviews/${created.id}/restore`, {
        method: "POST",
        token: moderator.token,
        params,
      }),
    );
    expect(restored).toMatchObject({ status: "PUBLISHED", moderationReason: null });
    expect(restored.moderationHistory).toHaveLength(2);
    expect((await (await publicList(productId)).json()).data.items[0].body).toBe(
      "Changed my words.",
    );
    const again = await call(restore, `/admin/reviews/${created.id}/restore`, {
      method: "POST",
      token: moderator.token,
      params,
    });
    expect((await errorOf(again, 409)).code).toBe("CONFLICT");
    const missing = await call(hide, `/admin/reviews/${UNKNOWN_ID}/hide`, {
      method: "POST",
      token: moderator.token,
      body: { reason: "x" },
      params: { reviewId: UNKNOWN_ID },
    });
    expect((await errorOf(missing, 404)).code).toBe("NOT_FOUND");

    expect(
      (
        await db.auditLog.findMany({
          where: { entityType: "REVIEW" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      ).map((a) => a.action),
    ).toEqual([
      "REVIEW_CREATED",
      "REVIEW_REPORTED",
      "REVIEW_HIDDEN",
      "REVIEW_UPDATED",
      "REVIEW_RESTORED",
    ]);

    // History is kept by the database too.
    await expect(db.review.delete({ where: { id: created.id } })).rejects.toThrow();
    await expect(db.reviewModerationEvent.deleteMany({})).rejects.toThrow();
    await expect(db.reviewModerationEvent.updateMany({ data: { reason: "x" } })).rejects.toThrow();
  });
});
