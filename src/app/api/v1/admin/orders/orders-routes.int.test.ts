import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as confirm } from "@/app/api/v1/admin/orders/[orderId]/confirm/route";
import { POST as markReady } from "@/app/api/v1/admin/orders/[orderId]/mark-ready-for-shipment/route";
import { GET as adminOrder } from "@/app/api/v1/admin/orders/[orderId]/route";
import { POST as startPreparing } from "@/app/api/v1/admin/orders/[orderId]/start-preparing/route";
import { GET as adminOrders } from "@/app/api/v1/admin/orders/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { POST as validate } from "@/app/api/v1/checkout/validate/route";
import { GET as myOrders } from "@/app/api/v1/me/orders/route";
import { GET as myOrder } from "@/app/api/v1/orders/[orderId]/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { SYSTEM_ACTOR } from "@/server/modules/audit/audit";
import { createSession } from "@/server/modules/auth/sessions";
import { changeOrderStatus } from "@/server/modules/orders/orders";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Orders: reads, staff transitions and immutable snapshots (TASK-030, Q46, Q82–Q84, R2, R4). */

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

async function list(res: Response) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body;
}

async function errorOf(res: Response, status: number) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.error;
}

let counter = 0;
let areaId: string;

async function product(price = 15000) {
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
      availableDelta: 10,
      reason: "Test stock",
      createdByType: "SYSTEM",
    },
  });
  return { productId: created.id, variantId, name: created.nameEn };
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
  return {
    customerId: account.customer!.id,
    phone: account.customer!.phone,
    token: session.tokens.accessToken,
  };
}

async function staff(codes: PermissionCode[], level: EmployeeLevel = "EMPLOYEE") {
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

const ADDRESS = () => ({
  recipientName: "Mona",
  phone: "01012345678",
  areaId,
  street: "9 Road 9",
});

/** Places an order through checkout; a customer when `token` is given, else a guest. */
async function placeOrder(variantId: string, token?: string) {
  counter += 1;
  const added = await data(
    await call(addItem, "/cart/items", {
      method: "POST",
      token,
      body: { variantId, quantity: 2 },
    }),
  );
  const who = { token, guest: token ? undefined : (added.guestCartToken as string) };
  const body = token
    ? { address: ADDRESS() }
    : { contact: { fullName: "Guest", phone: "01198765432" }, address: ADDRESS() };
  const quote = await data(
    await call(validate, "/checkout/validate", { method: "POST", ...who, body }),
  );
  return data(
    await call(checkout, "/checkout", {
      method: "POST",
      ...who,
      key: `o-${counter}`,
      body: { ...body, expectedTotal: quote.total },
    }),
    201,
  );
}

/** What TASK-031 does on COD confirmation: the System moves it to NEW. */
function systemConfirm(orderId: string) {
  return runInTransaction(
    (tx) => changeOrderStatus(tx, { orderId, to: "NEW", actor: SYSTEM_ACTOR, now: new Date() }),
    {},
    db,
  );
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

describe("customer orders", () => {
  it("lists and shows only the customer's own orders, from their snapshots", async () => {
    const { productId, variantId, name } = await product(15000);
    const sara = await customer();
    const other = await customer();
    const placed = await placeOrder(variantId, sara.token);
    await placeOrder(variantId, other.token);
    await placeOrder(variantId); // guest

    // Later catalog changes never touch the order (Q46, Q184).
    await db.product.update({ where: { id: productId }, data: { nameEn: "Renamed" } });
    await db.productVariant.update({
      where: { id: variantId },
      data: { sellingPrice: BigInt(99900) },
    });

    const mine = await list(await call(myOrders, "/me/orders", { token: sara.token }));
    expect(mine.data).toEqual([
      {
        id: placed.id,
        orderNumber: placed.orderNumber,
        status: "PENDING_CONFIRMATION",
        currency: "EGP",
        total: 35000,
        codAmount: 35000,
        itemCount: 1,
        createdAt: placed.createdAt,
      },
    ]);
    expect(mine.meta.pagination).toMatchObject({ page: 1, total: 1 });

    const detail = await data(
      await call(myOrder, `/orders/${placed.id}`, {
        token: sara.token,
        params: { orderId: placed.id },
      }),
    );
    expect(detail).toMatchObject({
      ...placed,
      discount: null,
      shippingAddress: { recipientName: "Mona", street: "9 Road 9", area: { nameEn: "Maadi" } },
      statusHistory: [{ status: "PENDING_CONFIRMATION", at: expect.any(String) }],
    });
    expect(detail.items[0]).toMatchObject({ name, unitPrice: 15000 });
    expect(detail.items[0]).not.toHaveProperty("unitCostAtSale");

    const foreign = await call(myOrder, `/orders/${placed.id}`, {
      token: other.token,
      params: { orderId: placed.id },
    });
    expect((await errorOf(foreign, 404)).code).toBe("NOT_FOUND");
    expect((await call(myOrders, "/me/orders")).status).toBe(401);
  });
});

describe("admin orders", () => {
  it("needs ORDERS_VIEW and hides contact data and costs without their permissions", async () => {
    const { variantId } = await product();
    const sara = await customer();
    const order = await placeOrder(variantId, sara.token);
    const guestOrder = await placeOrder(variantId);
    const params = { orderId: order.id };

    const nobody = await staff(["CONFIRM_ORDER"]);
    expect((await call(adminOrders, "/admin/orders", { token: nobody.token })).status).toBe(403);

    const warehouse = await staff(["ORDERS_VIEW"]);
    const plain = await data(
      await call(adminOrder, `/admin/orders/${order.id}`, { token: warehouse.token, params }),
    );
    expect(plain.customer).toEqual({ customerId: sara.customerId, fullName: "Sara" });
    expect(Object.keys(plain.shippingAddress).sort()).toEqual(["area", "governorate"]);
    expect(plain.items[0]).not.toHaveProperty("unitCostAtSale");
    expect(plain).toMatchObject({
      total: 35000,
      walletAmountReserved: 0,
      codAmount: 35000,
      taxIncluded: true,
      taxAmount: null,
      shipping: { rule: { ruleShippingFee: 5000 } },
      statusHistory: [{ fromStatus: null, toStatus: "PENDING_CONFIRMATION" }],
    });
    const byPhone = await call(
      adminOrders,
      `/admin/orders?phone=${encodeURIComponent(sara.phone)}`,
      {
        token: warehouse.token,
      },
    );
    expect((await errorOf(byPhone, 403)).code).toBe("PERMISSION_DENIED");

    const service = await staff(["ORDERS_VIEW", "VIEW_CUSTOMER_CONTACT", "VIEW_COST_PRICE"]);
    const full = await data(
      await call(adminOrder, `/admin/orders/${order.id}`, { token: service.token, params }),
    );
    expect(full.customer).toMatchObject({ phone: sara.phone });
    expect(full.shippingAddress).toMatchObject({ phone: "+201012345678", street: "9 Road 9" });
    expect(full.items[0].unitCostAtSale).toBe(9000);

    const found = await list(
      await call(adminOrders, `/admin/orders?phone=${encodeURIComponent("01198765432")}`, {
        token: service.token,
      }),
    );
    expect(found.data.map((o: { id: string }) => o.id)).toEqual([guestOrder.id]);
    expect(found.data[0].customer).toEqual({
      customerId: null,
      fullName: "Guest",
      phone: "+201198765432",
    });
    const bySearch = await list(
      await call(
        adminOrders,
        `/admin/orders?search=${order.orderNumber}&status=PENDING_CONFIRMATION`,
        {
          token: warehouse.token,
        },
      ),
    );
    expect(bySearch.data.map((o: { id: string }) => o.id)).toEqual([order.id]);
    const missing = await call(adminOrder, `/admin/orders/${UNKNOWN_ID}`, {
      token: warehouse.token,
      params: { orderId: UNKNOWN_ID },
    });
    expect(missing.status).toBe(404);
  });
});

describe("staff transitions (Q82–Q84, R4)", () => {
  it("moves New → Confirmed → Preparing → Ready for Shipment with history, audit and event", async () => {
    const { variantId } = await product();
    const order = await placeOrder(variantId);
    const params = { orderId: order.id };
    const ops = await staff(["ORDERS_VIEW", "CONFIRM_ORDER"]);
    const warehouse = await staff(["START_PREPARING", "MARK_READY_FOR_SHIPMENT"]);

    // Pending Confirmation → Confirmed is not a staff transition (R1).
    const early = await call(confirm, "/x", { method: "POST", token: ops.token, params });
    expect(await errorOf(early, 409)).toMatchObject({
      code: "ORDER_STATE_INVALID",
      details: { status: "PENDING_CONFIRMATION", to: "CONFIRMED" },
    });

    await systemConfirm(order.id);
    expect(
      (await call(startPreparing, "/x", { method: "POST", token: ops.token, params })).status,
    ).toBe(403);
    const confirmed = await data(
      await call(confirm, "/x", { method: "POST", token: ops.token, params }),
    );
    expect(confirmed).toMatchObject({ status: "CONFIRMED", confirmedAt: expect.any(String) });
    expect(
      (await errorOf(await call(confirm, "/x", { method: "POST", token: ops.token, params }), 409))
        .code,
    ).toBe("ORDER_STATE_INVALID");

    // Preparing → Shipped is never allowed directly: ready-for-shipment first.
    await data(
      await call(startPreparing, "/x", { method: "POST", token: warehouse.token, params }),
    );
    const ready = await data(
      await call(markReady, "/x", { method: "POST", token: warehouse.token, params }),
    );
    expect(ready.status).toBe("READY_FOR_SHIPMENT");
    expect(ready.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      "PENDING_CONFIRMATION",
      "NEW",
      "CONFIRMED",
      "PREPARING",
      "READY_FOR_SHIPMENT",
    ]);
    expect(ready.statusHistory[2]).toMatchObject({
      fromStatus: "NEW",
      changedByType: "EMPLOYEE",
      changedById: ops.employeeId,
    });

    const audits = await db.auditLog.findMany({
      where: { entityId: order.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "ORDER_CONFIRMED",
      "ORDER_PREPARING_STARTED",
      "ORDER_READY_FOR_SHIPMENT",
    ]);
    expect(
      await db.outboxEvent.count({
        where: { eventType: "ORDER_CONFIRMED", aggregateId: order.id },
      }),
    ).toBe(1);
    const unknown = await call(confirm, "/x", {
      method: "POST",
      token: ops.token,
      params: { orderId: UNKNOWN_ID },
    });
    expect(unknown.status).toBe(404);
  });
});

describe("immutable history (Q46, Q184, DB §24)", () => {
  it("rejects changes to snapshots, items and deletion; lifecycle fields stay writable", async () => {
    const { variantId } = await product();
    const order = await placeOrder(variantId);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const sara = await customer();

    await expect(
      db.order.update({
        where: { id: order.id },
        data: { shippingFee: BigInt(0), total: BigInt(30000), codAmount: BigInt(30000) },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.order.update({ where: { id: order.id }, data: { customerSnapshot: { fullName: "X" } } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.orderItem.update({ where: { id: item.id }, data: { skuSnapshot: "OTHER" } }),
    ).rejects.toThrow(/immutable/);
    await expect(db.orderItem.delete({ where: { id: item.id } })).rejects.toThrow(/immutable/);
    await expect(db.order.delete({ where: { id: order.id } })).rejects.toThrow(/never deleted/);

    // A guest order may be linked to an account once (Q43); never moved again.
    await db.order.update({ where: { id: order.id }, data: { customerId: sara.customerId } });
    const other = await customer();
    await expect(
      db.order.update({ where: { id: order.id }, data: { customerId: other.customerId } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.inventoryReservation.create({
        data: {
          orderId: UNKNOWN_ID,
          productVariantId: variantId,
          quantity: 1,
          reservedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});
