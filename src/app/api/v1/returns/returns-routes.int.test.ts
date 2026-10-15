import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approveReturn } from "@/app/api/v1/admin/returns/[returnId]/approve/route";
import { POST as requestPickup } from "@/app/api/v1/admin/returns/[returnId]/pickup/route";
import { POST as inspectItem } from "@/app/api/v1/admin/return-items/[returnItemId]/inspection/route";
import { POST as receiveReturn } from "@/app/api/v1/admin/returns/[returnId]/receive/route";
import { POST as rejectReturn } from "@/app/api/v1/admin/returns/[returnId]/reject/route";
import { POST as startInspection } from "@/app/api/v1/admin/returns/[returnId]/start-inspection/route";
import { GET as adminReturn } from "@/app/api/v1/admin/returns/[returnId]/route";
import { GET as adminReturns } from "@/app/api/v1/admin/returns/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { POST as validate } from "@/app/api/v1/checkout/validate/route";
import { GET as fileContent } from "@/app/api/v1/files/[id]/content/route";
import { POST as completeUpload } from "@/app/api/v1/files/complete/route";
import { POST as uploadInit } from "@/app/api/v1/files/upload-init/route";
import { PUT as uploadBytes } from "@/app/api/v1/files/uploads/[id]/route";
import { POST as deactivate } from "@/app/api/v1/me/deactivate/route";
import { GET as myReturns } from "@/app/api/v1/me/returns/route";
import { POST as createReturn } from "@/app/api/v1/orders/[orderId]/returns/route";
import { POST as cancelReturn } from "@/app/api/v1/returns/[returnId]/cancel/route";
import { POST as addEvidence } from "@/app/api/v1/returns/[returnId]/evidence/route";
import { POST as resubmit } from "@/app/api/v1/returns/[returnId]/resubmit/route";
import { GET as getReturn } from "@/app/api/v1/returns/[returnId]/route";
import { getDb } from "@/server/db/client";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { png } from "@/test/fixtures/images";
import { resetDatabase } from "@/test/integration/database";

/** Customer return requests (TASK-037, Q14, Q17, Q34, Q90–Q92, Q100, R21, R34). */

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
    rawBody?: Buffer;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en", ...options.headers });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.guest) headers.set("x-guest-cart-token", options.guest);
  if (options.key) headers.set("idempotency-key", `checkout-${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const body =
    options.rawBody !== undefined
      ? new Uint8Array(options.rawBody)
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);
  return (handler as Handler)(
    new Request(`${BASE}${path}`, { method: options.method ?? "GET", headers, body }),
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

async function variants() {
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
          { sku: `SKU-${counter}-A`, isDefault: true, sellingPrice: BigInt(15000) },
          { sku: `SKU-${counter}-B`, sellingPrice: BigInt(9000) },
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
  return created.variants.map((v) => v.id);
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
  });
  const created = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return created.tokens.accessToken;
}

/**
 * Places an order (2 × first variant, 1 × second) and sets it delivered at
 * `deliveredAt` directly (status `DELIVERED` unless given).
 */
async function order(
  token: string | undefined,
  options: { deliveredAt?: Date; status?: "DELIVERED" | "SHIPPED" } = {},
) {
  counter += 1;
  const [a, b] = await variants();
  let guest: string | undefined;
  for (const [variantId, quantity] of [
    [a, 2],
    [b, 1],
  ] as const) {
    const added = await data(
      await call(addItem, "/cart/items", {
        method: "POST",
        token,
        guest,
        body: { variantId, quantity },
      }),
    );
    guest = token ? undefined : ((added.guestCartToken as string | undefined) ?? guest);
  }
  const address = { recipientName: "Mona", phone: "01012345678", areaId, street: "9 Road 9" };
  const body = token
    ? { address }
    : { contact: { fullName: "Guest", phone: "01198765432" }, address };
  const who = { token, guest };
  const quote = await data(
    await call(validate, "/checkout/validate", { method: "POST", ...who, body }),
  );
  const placed = await data(
    await call(checkout, "/checkout", {
      method: "POST",
      ...who,
      key: `ret-${counter}`,
      body: { ...body, expectedTotal: quote.total },
    }),
    201,
  );
  const status = options.status ?? "DELIVERED";
  await db.order.update({
    where: { id: placed.id },
    data: {
      status,
      deliveredAt: status === "DELIVERED" ? (options.deliveredAt ?? new Date()) : null,
    },
  });
  const items = await db.orderItem.findMany({
    where: { orderId: placed.id },
    orderBy: { skuSnapshot: "asc" },
  });
  return { orderId: placed.id as string, itemIds: items.map((i) => i.id) };
}

/** A photo through the three upload steps (API §28): a customer's, or a staff inspection photo. */
async function photo(
  token: string,
  purpose: "RETURN_EVIDENCE" | "RETURN_INSPECTION" = "RETURN_EVIDENCE",
): Promise<string> {
  const bytes = png(800, 800);
  const started = await data(
    await call(uploadInit, "/files/upload-init", {
      method: "POST",
      token,
      body: {
        purpose,
        filename: "damage.png",
        mimeType: "image/png",
        sizeBytes: bytes.length,
      },
    }),
    201,
  );
  const sent = await call(uploadBytes, `/files/uploads/${started.mediaAssetId}`, {
    method: "PUT",
    headers: started.upload.headers,
    rawBody: bytes,
    params: { id: started.mediaAssetId },
  });
  expect(sent.status).toBe(204);
  const asset = await data(
    await call(completeUpload, "/files/complete", {
      method: "POST",
      token,
      body: { mediaAssetId: started.mediaAssetId },
    }),
  );
  expect(asset).toMatchObject({ purpose, scanStatus: "SAFE" });
  return asset.id;
}

function request(token: string | undefined, orderId: string, body: unknown) {
  return call(createReturn, `/orders/${orderId}/returns`, {
    method: "POST",
    token,
    body,
    params: { orderId },
  });
}

function onReturn(handler: unknown, action: string, token: string, id: string, body?: unknown) {
  return call(handler, `/returns/${id}/${action}`, {
    method: "POST",
    token,
    body,
    params: { returnId: id },
  });
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

describe("requesting a return", () => {
  it("creates a PENDING_APPROVAL partial return; the order stays DELIVERED", async () => {
    const sara = await customer();
    const { orderId, itemIds } = await order(sara.token);

    const created = await data(
      await request(sara.token, orderId, {
        claimType: "OTHER",
        reason: "  Changed my mind.  ",
        items: [{ orderItemId: itemIds[0], quantity: 1 }],
      }),
      201,
    );
    expect(created).toMatchObject({
      returnNumber: "RT-000001",
      orderId,
      status: "PENDING_APPROVAL",
      claimType: "OTHER",
      reason: "Changed my mind.",
      resubmittedFromReturnId: null,
      evidence: [],
      items: [{ orderItemId: itemIds[0], orderedQuantity: 2, requestedQuantity: 1 }],
    });
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");

    // The rest of the order can still be returned, but not more than was bought.
    await data(
      await request(sara.token, orderId, {
        claimType: "OTHER",
        reason: "Also this.",
        items: [
          { orderItemId: itemIds[0], quantity: 1 },
          { orderItemId: itemIds[1], quantity: 1 },
        ],
      }),
      201,
    );
    const tooMany = await errorOf(
      await request(sara.token, orderId, {
        claimType: "OTHER",
        reason: "Again.",
        items: [{ orderItemId: itemIds[0], quantity: 1 }],
      }),
      409,
    );
    expect(tooMany).toMatchObject({
      code: "CONFLICT",
      details: { reason: "RETURN_QUANTITY_EXCEEDED", returnableQuantity: 0 },
    });

    const mine = await call(myReturns, "/me/returns", { token: sara.token });
    const listed = await mine.json();
    expect(listed.data).toHaveLength(2);
    expect(listed.meta.pagination).toMatchObject({ total: 2 });
    expect(
      await data(
        await call(getReturn, `/returns/${created.id}`, {
          token: sara.token,
          params: { returnId: created.id },
        }),
      ),
    ).toEqual(created);

    const audit = await db.auditLog.findMany({ where: { action: "RETURN_REQUESTED" } });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actorType: "CUSTOMER", actorId: sara.customerId });
  });

  it("enforces the 14-day window from the actual delivery (R21)", async () => {
    const sara = await customer();
    const body = (itemId: string) => ({
      claimType: "OTHER",
      reason: "Late.",
      items: [{ orderItemId: itemId, quantity: 1 }],
    });
    const late = await order(sara.token, { deliveredAt: new Date(Date.now() - 16 * MS_PER_DAY) });
    const expired = await errorOf(
      await request(sara.token, late.orderId, body(late.itemIds[0])),
      422,
    );
    expect(expired.code).toBe("RETURN_WINDOW_EXPIRED");
    expect(expired.details.returnWindowEndsAt).toBeDefined();

    const recent = await order(sara.token, {
      deliveredAt: new Date(Date.now() - 13 * MS_PER_DAY),
    });
    await data(await request(sara.token, recent.orderId, body(recent.itemIds[0])), 201);
  });

  it("needs the customer's own delivered order and valid lines", async () => {
    const sara = await customer();
    const other = await customer();
    const shipped = await order(sara.token, { status: "SHIPPED" });
    const delivered = await order(sara.token);
    const guest = await order(undefined);
    const body = (itemId: string) => ({
      claimType: "OTHER",
      reason: "No.",
      items: [{ orderItemId: itemId, quantity: 1 }],
    });

    expect(
      await errorOf(await request(sara.token, shipped.orderId, body(shipped.itemIds[0])), 409),
    ).toMatchObject({
      code: "ORDER_STATE_INVALID",
      details: { status: "SHIPPED", required: "DELIVERED" },
    });
    for (const [token, target] of [
      [other.token, delivered],
      [sara.token, guest],
    ] as const) {
      expect(
        (await errorOf(await request(token, target.orderId, body(target.itemIds[0])), 404)).code,
      ).toBe("NOT_FOUND");
    }
    expect((await request(sara.token, UNKNOWN_ID, body(delivered.itemIds[0]))).status).toBe(404);
    // A line of another order.
    const foreign = await errorOf(
      await request(sara.token, delivered.orderId, body(shipped.itemIds[0])),
      400,
    );
    expect(foreign.details.issues[0]).toMatchObject({ code: "order_item_not_found" });
    expect((await request(undefined, delivered.orderId, body(delivered.itemIds[0]))).status).toBe(
      401,
    );
    const blank = await errorOf(
      await request(sara.token, delivered.orderId, { ...body(delivered.itemIds[0]), reason: " " }),
      400,
    );
    expect(blank.code).toBe("VALIDATION_ERROR");
    expect(await db.return.count()).toBe(0);
  });
});

describe("evidence (Q100)", () => {
  it("requires a photo for damaged or wrong items and accepts only the customer's own", async () => {
    const sara = await customer();
    const other = await customer();
    const { orderId, itemIds } = await order(sara.token);
    const base = {
      claimType: "DAMAGED",
      reason: "The bottle arrived cracked.",
      items: [{ orderItemId: itemIds[0], quantity: 2 }],
    };

    const missing = await errorOf(await request(sara.token, orderId, base), 400);
    expect(missing.details.issues[0]).toMatchObject({
      path: "evidenceMediaAssetIds",
      code: "evidence_required",
    });

    const othersPhoto = await photo(other.token);
    const foreign = await errorOf(
      await request(sara.token, orderId, { ...base, evidenceMediaAssetIds: [othersPhoto] }),
      400,
    );
    expect(foreign.details.issues[0]).toMatchObject({ code: "media_asset_not_found" });

    const first = await photo(sara.token);
    const created = await data(
      await request(sara.token, orderId, { ...base, evidenceMediaAssetIds: [first] }),
      201,
    );
    expect(created.evidence).toEqual([
      expect.objectContaining({ mediaAssetId: first, url: `/api/v1/files/${first}/content` }),
    ]);

    // More photos while it waits; an attached photo cannot be reused.
    const second = await photo(sara.token);
    const updated = await data(
      await onReturn(addEvidence, "evidence", sara.token, created.id, {
        mediaAssetIds: [second],
      }),
    );
    expect(updated.evidence.map((e: { mediaAssetId: string }) => e.mediaAssetId)).toEqual([
      first,
      second,
    ]);
    const reused = await errorOf(
      await onReturn(addEvidence, "evidence", sara.token, created.id, { mediaAssetIds: [first] }),
      409,
    );
    expect(reused.details.reason).toBe("MEDIA_ALREADY_ATTACHED");
    expect(
      (
        await onReturn(addEvidence, "evidence", other.token, created.id, {
          mediaAssetIds: [second],
        })
      ).status,
    ).toBe(404);

    // Staff with RETURNS_VIEW see the photos; others do not.
    const viewer = await staff(["RETURNS_VIEW"]);
    const outsider = await staff(["PRODUCT_VIEW"]);
    const path = `/files/${first}/content`;
    expect((await call(fileContent, path, { token: viewer, params: { id: first } })).status).toBe(
      200,
    );
    expect((await call(fileContent, path, { token: outsider, params: { id: first } })).status).toBe(
      404,
    );
    expect(await db.auditLog.count({ where: { action: "RETURN_EVIDENCE_ADDED" } })).toBe(1);
  });

  it("keeps customers to return evidence and staff to their purposes", async () => {
    const sara = await customer();
    const owner = await staff(["MANAGE_PRODUCT_MEDIA"]);
    const file = { filename: "a.png", mimeType: "image/png", sizeBytes: 10 };
    expect(
      (
        await call(uploadInit, "/files/upload-init", {
          method: "POST",
          token: sara.token,
          body: { purpose: "PRODUCT_MEDIA", ...file },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(uploadInit, "/files/upload-init", {
          method: "POST",
          token: owner,
          body: { purpose: "RETURN_EVIDENCE", ...file },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(uploadInit, "/files/upload-init", {
          method: "POST",
          body: { purpose: "RETURN_EVIDENCE", ...file },
        })
      ).status,
    ).toBe(401);
  });
});

describe("withdrawing and resubmitting", () => {
  it("cancels while pending, releasing the quantities; resubmits only after a rejection", async () => {
    const sara = await customer();
    const { orderId, itemIds } = await order(sara.token);
    const body = {
      claimType: "OTHER",
      reason: "Wrong shade for me.",
      items: [{ orderItemId: itemIds[0], quantity: 2 }],
    };
    const first = await data(await request(sara.token, orderId, body), 201);

    const early = await errorOf(
      await onReturn(resubmit, "resubmit", sara.token, first.id, body),
      409,
    );
    expect(early).toMatchObject({
      code: "RETURN_STATE_INVALID",
      details: { status: "PENDING_APPROVAL", required: "REJECTED" },
    });

    const cancelled = await data(await onReturn(cancelReturn, "cancel", sara.token, first.id));
    expect(cancelled).toMatchObject({ status: "CANCELLED" });
    expect(cancelled.cancelledAt).not.toBeNull();
    const again = await errorOf(await onReturn(cancelReturn, "cancel", sara.token, first.id), 409);
    expect(again).toMatchObject({ code: "RETURN_STATE_INVALID", details: { status: "CANCELLED" } });

    // Cancelled quantities can be asked for again; staff reject (TASK-038).
    const second = await data(await request(sara.token, orderId, body), 201);
    await data(
      await call(rejectReturn, `/admin/returns/${second.id}/reject`, {
        method: "POST",
        token: await staff(["APPROVE_RETURN"]),
        body: { reason: "Opened item." },
        params: { returnId: second.id },
      }),
    );
    const third = await data(
      await onReturn(resubmit, "resubmit", sara.token, second.id, {
        ...body,
        reason: "Unopened, wrong shade.",
      }),
      201,
    );
    expect(third).toMatchObject({
      status: "PENDING_APPROVAL",
      resubmittedFromReturnId: second.id,
      reason: "Unopened, wrong shade.",
    });
    // The rejected request is unchanged (Q92).
    expect(await db.return.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      status: "REJECTED",
      customerReasonText: "Wrong shade for me.",
    });
    expect(await db.auditLog.count({ where: { action: "RETURN_CANCELLED" } })).toBe(1);
  });

  it("refuses deactivation while a return is open (R34)", async () => {
    const sara = await customer();
    const { orderId, itemIds } = await order(sara.token);
    await data(
      await request(sara.token, orderId, {
        claimType: "OTHER",
        reason: "Return.",
        items: [{ orderItemId: itemIds[1], quantity: 1 }],
      }),
      201,
    );
    const password = "Correct-Horse-9";
    await db.account.updateMany({
      where: { customer: { id: sara.customerId } },
      data: { passwordHash: await createScryptHasher().hash(password) },
    });
    const refused = await errorOf(
      await call(deactivate, "/me/deactivate", {
        method: "POST",
        token: sara.token,
        body: { currentPassword: password },
      }),
      409,
    );
    expect(refused.details).toEqual({
      reason: "ACCOUNT_HAS_OPEN_ITEMS",
      openItems: ["OPEN_RETURN"],
    });
  });
});

describe("admin view", () => {
  it("lists and shows returns with RETURNS_VIEW", async () => {
    const sara = await customer();
    const { orderId, itemIds } = await order(sara.token);
    const created = await data(
      await request(sara.token, orderId, {
        claimType: "OTHER",
        reason: "Return.",
        items: [{ orderItemId: itemIds[1], quantity: 1 }],
      }),
      201,
    );
    const viewer = await staff(["RETURNS_VIEW"]);
    const res = await call(adminReturns, "/admin/returns?status=PENDING_APPROVAL", {
      token: viewer,
    });
    const listed = await res.json();
    expect(res.status).toBe(200);
    expect(listed.data).toEqual([
      {
        ...created,
        items: created.items.map((item: object) => ({ ...item, inspection: null })),
        customerId: sara.customerId,
        approvedByEmployeeId: null,
        statusHistory: [
          {
            fromStatus: null,
            toStatus: "PENDING_APPROVAL",
            changedByType: "CUSTOMER",
            changedById: sara.customerId,
            reason: null,
            createdAt: created.createdAt,
          },
        ],
      },
    ]);
    expect(
      await data(
        await call(adminReturn, `/admin/returns/${created.id}`, {
          token: viewer,
          params: { returnId: created.id },
        }),
      ),
    ).toMatchObject({ id: created.id, customerId: sara.customerId });
    const denied = await errorOf(
      await call(adminReturns, "/admin/returns", { token: await staff(["ORDERS_VIEW"]) }),
      403,
    );
    expect(denied.code).toBe("PERMISSION_DENIED");
    expect(
      (
        await call(adminReturn, `/admin/returns/${UNKNOWN_ID}`, {
          token: viewer,
          params: { returnId: UNKNOWN_ID },
        })
      ).status,
    ).toBe(404);
  });

  it("keeps returns and evidence history in the database", async () => {
    const sara = await customer();
    const { orderId, itemIds } = await order(sara.token);
    const created = await data(
      await request(sara.token, orderId, {
        claimType: "WRONG_ITEM",
        reason: "Got another product.",
        items: [{ orderItemId: itemIds[1], quantity: 1 }],
        evidenceMediaAssetIds: [await photo(sara.token)],
      }),
      201,
    );
    await expect(db.return.delete({ where: { id: created.id } })).rejects.toThrow();
    await expect(
      db.returnEvidence.deleteMany({ where: { returnId: created.id } }),
    ).rejects.toThrow();
    await expect(db.returnItem.deleteMany({ where: { returnId: created.id } })).rejects.toThrow();
  });
});

describe("staff review and pickup (TASK-038)", () => {
  /** A customer's waiting return of one unit of the order's second line. */
  async function waiting() {
    const sara = await customer();
    const { orderId, itemIds } = await order(sara.token);
    const created = await data(
      await request(sara.token, orderId, {
        claimType: "OTHER",
        reason: "Changed my mind.",
        items: [{ orderItemId: itemIds[1], quantity: 1 }],
      }),
      201,
    );
    return { sara, orderId, itemIds, returnId: created.id as string };
  }

  function admin(handler: unknown, action: string, token: string, id: string, body?: unknown) {
    return call(handler, `/admin/returns/${id}/${action}`, {
      method: "POST",
      token,
      body,
      params: { returnId: id },
    });
  }

  async function carrier(status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
    counter += 1;
    return db.shippingCompany.create({ data: { code: `CAR${counter}`, name: "Carrier", status } });
  }

  it("approves a waiting return with history, audit and an outbox event", async () => {
    const { sara, orderId, returnId } = await waiting();
    const approver = await staff(["APPROVE_RETURN"]);

    const approved = await data(
      await admin(approveReturn, "approve", approver, returnId, { note: "  Photos fine. " }),
    );
    expect(approved).toMatchObject({ status: "APPROVED", rejectedAt: null, pickup: null });
    expect(approved.approvedAt).toEqual(expect.any(String));
    expect(approved.statusHistory).toMatchObject([
      { fromStatus: null, toStatus: "PENDING_APPROVAL", changedByType: "CUSTOMER" },
      {
        fromStatus: "PENDING_APPROVAL",
        toStatus: "APPROVED",
        changedByType: "EMPLOYEE",
        changedById: approved.approvedByEmployeeId,
        reason: "Photos fine.",
      },
    ]);
    expect(
      await db.auditLog.count({ where: { action: "RETURN_APPROVED", entityId: returnId } }),
    ).toBe(1);
    expect(
      await db.outboxEvent.count({
        where: { eventType: "RETURN_APPROVED", aggregateId: returnId },
      }),
    ).toBe(1);
    // The order is untouched (Q90); the customer sees the approval.
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED");
    const mine = await data(
      await call(getReturn, `/returns/${returnId}`, {
        token: sara.token,
        params: { returnId },
      }),
    );
    expect(mine).toMatchObject({ status: "APPROVED", approvedAt: approved.approvedAt });
    expect(mine).not.toHaveProperty("statusHistory");

    // No second review, no withdrawal once approved.
    for (const [handler, action, body] of [
      [approveReturn, "approve", undefined],
      [rejectReturn, "reject", { reason: "No." }],
    ] as const) {
      const refused = await errorOf(await admin(handler, action, approver, returnId, body), 409);
      expect(refused).toMatchObject({
        code: "RETURN_STATE_INVALID",
        details: { status: "APPROVED", required: "PENDING_APPROVAL" },
      });
    }
    expect(
      (await errorOf(await onReturn(cancelReturn, "cancel", sara.token, returnId), 409)).code,
    ).toBe("RETURN_STATE_INVALID");
  });

  it("rejects with a required reason shown to the customer, who may resubmit", async () => {
    const { sara, itemIds, returnId } = await waiting();
    const approver = await staff(["APPROVE_RETURN"]);

    expect(
      (await errorOf(await admin(rejectReturn, "reject", approver, returnId, {}), 400)).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      (await errorOf(await admin(rejectReturn, "reject", approver, returnId, { reason: " " }), 400))
        .code,
    ).toBe("VALIDATION_ERROR");

    const rejected = await data(
      await admin(rejectReturn, "reject", approver, returnId, { reason: "Outside policy." }),
    );
    expect(rejected).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Outside policy.",
      approvedAt: null,
      approvedByEmployeeId: null,
    });
    expect(rejected.statusHistory.at(-1)).toMatchObject({
      fromStatus: "PENDING_APPROVAL",
      toStatus: "REJECTED",
      reason: "Outside policy.",
    });
    expect(
      await db.auditLog.count({ where: { action: "RETURN_REJECTED", entityId: returnId } }),
    ).toBe(1);
    const mine = await data(
      await call(getReturn, `/returns/${returnId}`, { token: sara.token, params: { returnId } }),
    );
    expect(mine).toMatchObject({ status: "REJECTED", rejectionReason: "Outside policy." });

    const refused = await errorOf(await admin(approveReturn, "approve", approver, returnId), 409);
    expect(refused.details).toEqual({ status: "REJECTED", required: "PENDING_APPROVAL" });
    // The units are free again (Q92).
    await data(
      await onReturn(resubmit, "resubmit", sara.token, returnId, {
        claimType: "OTHER",
        reason: "Corrected.",
        items: [{ orderItemId: itemIds[1], quantity: 1 }],
      }),
      201,
    );
  });

  it("arranges the carrier pickup of an approved return only", async () => {
    const { sara, returnId } = await waiting();
    const manager = await staff(["MANAGE_RETURNS"]);
    const company = await carrier();
    const pickup = (body: unknown) => admin(requestPickup, "pickup", manager, returnId, body);

    const early = await errorOf(await pickup({ shippingCompanyId: company.id }), 409);
    expect(early).toMatchObject({
      code: "RETURN_STATE_INVALID",
      details: { status: "PENDING_APPROVAL", required: "APPROVED" },
    });
    await data(await admin(approveReturn, "approve", await staff(["APPROVE_RETURN"]), returnId));

    expect((await errorOf(await pickup({}), 400)).code).toBe("VALIDATION_ERROR");
    expect((await errorOf(await pickup({ shippingCompanyId: UNKNOWN_ID }), 400)).code).toBe(
      "VALIDATION_ERROR",
    );
    const inactive = await carrier("INACTIVE");
    expect((await errorOf(await pickup({ shippingCompanyId: inactive.id }), 400)).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      (
        await errorOf(
          await pickup({ shippingCompanyId: company.id, feePayer: "SOMEONE_ELSE" }),
          400,
        )
      ).code,
    ).toBe("VALIDATION_ERROR");

    const scheduled = await data(
      await pickup({ shippingCompanyId: company.id, trackingNumber: "RP-123", notes: "Evening." }),
    );
    expect(scheduled).toMatchObject({
      status: "PICKUP_SCHEDULED",
      pickup: {
        shippingCompany: { id: company.id, code: company.code, name: "Carrier" },
        trackingNumber: "RP-123",
        feePayer: "CUSTOMER",
      },
    });
    expect(scheduled.statusHistory.at(-1)).toMatchObject({
      fromStatus: "APPROVED",
      toStatus: "PICKUP_SCHEDULED",
      changedByType: "EMPLOYEE",
      reason: "Evening.",
    });
    expect(
      await db.auditLog.count({ where: { action: "RETURN_PICKUP_REQUESTED", entityId: returnId } }),
    ).toBe(1);
    const mine = await data(
      await call(getReturn, `/returns/${returnId}`, { token: sara.token, params: { returnId } }),
    );
    expect(mine.pickup).toEqual(scheduled.pickup);

    const again = await errorOf(await pickup({ shippingCompanyId: company.id }), 409);
    expect(again.details).toEqual({ status: "PICKUP_SCHEDULED", required: "APPROVED" });
  });

  it("records BeautyFits as the pickup payer when staff choose it", async () => {
    const { returnId } = await waiting();
    await data(await admin(approveReturn, "approve", await staff(["APPROVE_RETURN"]), returnId));
    const company = await carrier();
    const scheduled = await data(
      await admin(requestPickup, "pickup", await staff(["MANAGE_RETURNS"]), returnId, {
        shippingCompanyId: company.id,
        feePayer: "BEAUTYFITS",
      }),
    );
    expect(scheduled.pickup).toMatchObject({ trackingNumber: null, feePayer: "BEAUTYFITS" });
  });

  it("needs the right permission for each action", async () => {
    const { sara, returnId } = await waiting();
    const company = await carrier();
    const viewer = await staff(["RETURNS_VIEW", "MANAGE_RETURNS"]);
    for (const [handler, action, body] of [
      [approveReturn, "approve", undefined],
      [rejectReturn, "reject", { reason: "No." }],
    ] as const) {
      const denied = await errorOf(await admin(handler, action, viewer, returnId, body), 403);
      expect(denied.code).toBe("PERMISSION_DENIED");
    }
    const approver = await staff(["APPROVE_RETURN"]);
    await data(await admin(approveReturn, "approve", approver, returnId));
    const denied = await errorOf(
      await admin(requestPickup, "pickup", approver, returnId, { shippingCompanyId: company.id }),
      403,
    );
    expect(denied.code).toBe("PERMISSION_DENIED");
    // A customer session is not a staff session.
    expect((await admin(approveReturn, "approve", sara.token, returnId)).status).toBe(403);
    expect((await admin(approveReturn, "approve", approver, UNKNOWN_ID)).status).toBe(404);
  });

  it("keeps the status history append-only, including the customer's moves", async () => {
    const { sara, returnId } = await waiting();
    await data(await onReturn(cancelReturn, "cancel", sara.token, returnId));
    const history = await db.returnStatusHistory.findMany({
      where: { returnId },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => [h.fromStatus, h.toStatus, h.changedByType])).toEqual([
      [null, "PENDING_APPROVAL", "CUSTOMER"],
      ["PENDING_APPROVAL", "CANCELLED", "CUSTOMER"],
    ]);
    await expect(
      db.returnStatusHistory.updateMany({ where: { returnId }, data: { reason: "x" } }),
    ).rejects.toThrow();
    await expect(db.returnStatusHistory.deleteMany({ where: { returnId } })).rejects.toThrow();
  });
});

describe("receiving and inspection (TASK-039)", () => {
  function admin(handler: unknown, action: string, token: string, id: string, body?: unknown) {
    return call(handler, `/admin/returns/${id}/${action}`, {
      method: "POST",
      token,
      body,
      params: { returnId: id },
    });
  }

  function inspect(token: string, returnItemId: string, body: unknown) {
    return call(inspectItem, `/admin/return-items/${returnItemId}/inspection`, {
      method: "POST",
      token,
      body,
      params: { returnItemId },
    });
  }

  /** A return of the whole order (2 + 1 units), picked up by a carrier. */
  async function pickedUp() {
    const sara = await customer();
    const { orderId, itemIds } = await order(sara.token);
    const created = await data(
      await request(sara.token, orderId, {
        claimType: "OTHER",
        reason: "Changed my mind.",
        items: [
          { orderItemId: itemIds[0], quantity: 2 },
          { orderItemId: itemIds[1], quantity: 1 },
        ],
      }),
      201,
    );
    const returnId = created.id as string;
    await data(await admin(approveReturn, "approve", await staff(["APPROVE_RETURN"]), returnId));
    counter += 1;
    const company = await db.shippingCompany.create({
      data: { code: `CAR${counter}`, name: "Carrier" },
    });
    await data(
      await admin(requestPickup, "pickup", await staff(["MANAGE_RETURNS"]), returnId, {
        shippingCompanyId: company.id,
      }),
    );
    const items = await db.returnItem.findMany({
      where: { returnId },
      include: { orderItem: true },
      orderBy: { orderItem: { skuSnapshot: "asc" } },
    });
    return { sara, returnId, items };
  }

  async function available(variantId: string) {
    return (await db.inventoryBalance.findUniqueOrThrow({ where: { productVariantId: variantId } }))
      .availableQuantity;
  }

  it("receives, starts inspection and inspects per unit, restocking only sellable units", async () => {
    const { sara, returnId, items } = await pickedUp();
    const receiver = await staff(["RECEIVE_RETURN"]);
    const inspector = await staff(["INSPECT_RETURN"]);

    const early = await errorOf(
      await admin(startInspection, "start-inspection", inspector, returnId),
      409,
    );
    expect(early.details).toEqual({ status: "PICKUP_SCHEDULED", required: "RECEIVED" });

    const received = await data(
      await admin(receiveReturn, "receive", receiver, returnId, { notes: "Box intact." }),
    );
    expect(received).toMatchObject({ status: "RECEIVED", receivedAt: expect.any(String) });
    expect(received.statusHistory.at(-1)).toMatchObject({
      fromStatus: "PICKUP_SCHEDULED",
      toStatus: "RECEIVED",
      changedByType: "EMPLOYEE",
      reason: "Box intact.",
    });
    expect(
      await db.outboxEvent.count({
        where: { eventType: "RETURN_RECEIVED", aggregateId: returnId },
      }),
    ).toBe(1);
    const again = await errorOf(await admin(receiveReturn, "receive", receiver, returnId), 409);
    expect(again.details).toEqual({ status: "RECEIVED", required: "PICKUP_SCHEDULED" });

    // No inspection before it is started.
    const notYet = await errorOf(
      await inspect(inspector, items[1].id, {
        outcomes: [{ result: "DAMAGED", condition: "DAMAGED", quantity: 1 }],
      }),
      409,
    );
    expect(notYet).toMatchObject({
      code: "RETURN_STATE_INVALID",
      details: { status: "RECEIVED", required: "INSPECTING" },
    });

    const started = await data(
      await admin(startInspection, "start-inspection", inspector, returnId),
    );
    expect(started.status).toBe("INSPECTING");
    expect(started.items.map((i: { inspection: unknown }) => i.inspection)).toEqual([null, null]);

    const [lineA, lineB] = items;
    const beforeA = await available(lineA.orderItem.productVariantId);
    const beforeB = await available(lineB.orderItem.productVariantId);

    // Every unit once; restock only when sellable (Q36).
    for (const outcomes of [
      [{ result: "RESTOCK", condition: "SELLABLE", quantity: 1 }],
      [{ result: "RESTOCK", condition: "SELLABLE", quantity: 3 }],
      [
        { result: "RESTOCK", condition: "OPENED_USED", quantity: 1 },
        { result: "DAMAGED", condition: "DAMAGED", quantity: 1 },
      ],
      [{ result: "RETURN_TO_CUSTOMER", condition: "SELLABLE", quantity: 2 }],
    ]) {
      expect((await errorOf(await inspect(inspector, lineA.id, { outcomes }), 400)).code).toBe(
        "VALIDATION_ERROR",
      );
    }

    // Q35: 1 restock + 1 customer-opened, with notes and a staff photo.
    const evidence = await photo(inspector, "RETURN_INSPECTION");
    const inspected = await data(
      await inspect(inspector, lineA.id, {
        outcomes: [
          { result: "RESTOCK", condition: "SELLABLE", quantity: 1, notes: "Sealed." },
          { result: "DAMAGED", condition: "OPENED_USED", quantity: 1, notes: "Seal broken." },
        ],
        evidenceMediaAssetIds: [evidence],
      }),
    );
    const viewA = inspected.items.find((i: { id: string }) => i.id === lineA.id);
    expect(viewA.inspection).toMatchObject({
      inspectedAt: expect.any(String),
      outcomes: [
        { result: "RESTOCK", condition: "SELLABLE", quantity: 1, notes: "Sealed." },
        { result: "DAMAGED", condition: "OPENED_USED", quantity: 1, notes: "Seal broken." },
      ],
      evidence: [{ mediaAssetId: evidence }],
    });
    expect(inspected.status).toBe("INSPECTING");
    expect(await available(lineA.orderItem.productVariantId)).toBe(beforeA + 1);
    const movements = await db.inventoryMovement.findMany({
      where: { movementType: "CUSTOMER_RETURN_RESTOCK", referenceId: returnId },
    });
    expect(movements).toMatchObject([
      {
        productVariantId: lineA.orderItem.productVariantId,
        availableDelta: 1,
        damagedDelta: 0,
        referenceType: "RETURN",
        createdByType: "EMPLOYEE",
      },
    ]);
    expect(
      await db.auditLog.count({ where: { action: "RETURN_ITEM_INSPECTED", entityId: returnId } }),
    ).toBe(1);

    // Once per line; a photo once.
    const twice = await errorOf(
      await inspect(inspector, lineA.id, {
        outcomes: [{ result: "REJECTED", condition: "REJECTED", quantity: 2 }],
      }),
      409,
    );
    expect(twice.details.reason).toBe("RETURN_ITEM_ALREADY_INSPECTED");
    const reused = await errorOf(
      await inspect(inspector, lineB.id, {
        outcomes: [{ result: "REJECTED", condition: "REJECTED", quantity: 1 }],
        evidenceMediaAssetIds: [evidence],
      }),
      409,
    );
    expect(reused.details.reason).toBe("MEDIA_ALREADY_ATTACHED");
    // A customer's return photo is not an inspection photo.
    const customerPhoto = await photo(sara.token);
    expect(
      (
        await errorOf(
          await inspect(inspector, lineB.id, {
            outcomes: [{ result: "REJECTED", condition: "REJECTED", quantity: 1 }],
            evidenceMediaAssetIds: [customerPhoto],
          }),
          400,
        )
      ).code,
    ).toBe("VALIDATION_ERROR");

    // A rejected line: no stock change.
    await data(
      await inspect(inspector, lineB.id, {
        outcomes: [{ result: "REJECTED", condition: "REJECTED", quantity: 1 }],
      }),
    );
    expect(await available(lineB.orderItem.productVariantId)).toBe(beforeB);

    // Customers see the status, not the staff inspection.
    const mine = await data(
      await call(getReturn, `/returns/${returnId}`, { token: sara.token, params: { returnId } }),
    );
    expect(mine).toMatchObject({ status: "INSPECTING", receivedAt: received.receivedAt });
    expect(mine.items[0]).not.toHaveProperty("inspection");

    // Inspection records are append-only.
    await expect(
      db.returnInspection.updateMany({ where: { returnItemId: lineA.id }, data: { quantity: 2 } }),
    ).rejects.toThrow();
    await expect(
      db.returnInspection.deleteMany({ where: { returnItemId: lineA.id } }),
    ).rejects.toThrow();
    await expect(db.returnInspectionEvidence.deleteMany({})).rejects.toThrow();
  });

  it("serializes concurrent inspections of one line: one restock only", async () => {
    const { returnId, items } = await pickedUp();
    await data(await admin(receiveReturn, "receive", await staff(["RECEIVE_RETURN"]), returnId));
    const inspector = await staff(["INSPECT_RETURN"]);
    await data(await admin(startInspection, "start-inspection", inspector, returnId));
    const line = items[0];
    const before = await available(line.orderItem.productVariantId);

    const results = await Promise.all(
      [1, 2].map(() =>
        inspect(inspector, line.id, {
          outcomes: [{ result: "RESTOCK", condition: "SELLABLE", quantity: 2 }],
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await available(line.orderItem.productVariantId)).toBe(before + 2);
    expect(await db.returnInspection.count({ where: { returnItemId: line.id } })).toBe(1);
  });

  it("needs RECEIVE_RETURN / INSPECT_RETURN", async () => {
    const { sara, returnId, items } = await pickedUp();
    const viewer = await staff(["RETURNS_VIEW", "INSPECT_RETURN"]);
    expect((await errorOf(await admin(receiveReturn, "receive", viewer, returnId), 403)).code).toBe(
      "PERMISSION_DENIED",
    );
    const receiver = await staff(["RECEIVE_RETURN"]);
    await data(await admin(receiveReturn, "receive", receiver, returnId));
    expect(
      (await errorOf(await admin(startInspection, "start-inspection", receiver, returnId), 403))
        .code,
    ).toBe("PERMISSION_DENIED");
    await data(await admin(startInspection, "start-inspection", viewer, returnId));
    const body = { outcomes: [{ result: "REJECTED", condition: "REJECTED", quantity: 1 }] };
    expect((await errorOf(await inspect(receiver, items[1].id, body), 403)).code).toBe(
      "PERMISSION_DENIED",
    );
    expect((await inspect(sara.token, items[1].id, body)).status).toBe(403);
    expect((await errorOf(await inspect(viewer, UNKNOWN_ID, body), 404)).code).toBe("NOT_FOUND");
    expect((await admin(receiveReturn, "receive", receiver, UNKNOWN_ID)).status).toBe(404);
  });
});
