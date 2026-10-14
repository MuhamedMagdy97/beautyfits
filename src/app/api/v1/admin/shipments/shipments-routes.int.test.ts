import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as updateTask } from "@/app/api/v1/admin/contact-tasks/[taskId]/route";
import { GET as listTasks } from "@/app/api/v1/admin/contact-tasks/route";
import { POST as assignShipping } from "@/app/api/v1/admin/orders/[orderId]/assign-shipping/route";
import { POST as confirm } from "@/app/api/v1/admin/orders/[orderId]/confirm/route";
import { POST as markReady } from "@/app/api/v1/admin/orders/[orderId]/mark-ready-for-shipment/route";
import { POST as markShipped } from "@/app/api/v1/admin/orders/[orderId]/mark-shipped/route";
import { POST as startPreparing } from "@/app/api/v1/admin/orders/[orderId]/start-preparing/route";
import { POST as shipmentStatus } from "@/app/api/v1/admin/shipments/[shipmentId]/status/route";
import { POST as tracking } from "@/app/api/v1/admin/shipments/[shipmentId]/tracking/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { POST as checkout } from "@/app/api/v1/checkout/route";
import { POST as validate } from "@/app/api/v1/checkout/validate/route";
import { GET as myOrder } from "@/app/api/v1/orders/[orderId]/route";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { SYSTEM_ACTOR } from "@/server/modules/audit/audit";
import { createSession } from "@/server/modules/auth/sessions";
import { changeOrderStatus } from "@/server/modules/orders/orders";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_DAY, MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Shipments: carrier, handoff, tracking and delivery (TASK-034, Q84, Q85, Q126, R2, R4, R38.7). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  options: {
    token?: string;
    guest?: string;
    key?: string;
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, string>;
    method?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  const url = new URL(`${BASE}/x`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(name, value);
  }
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.guest) headers.set("x-guest-cart-token", options.guest);
  if (options.key) headers.set("idempotency-key", `checkout-${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return (handler as Handler)(
    new Request(url, {
      method: options.method ?? "POST",
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
        create: [{ sku: `SKU-${counter}`, isDefault: true, sellingPrice: BigInt(15000) }],
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
  return variantId;
}

async function customer(walletCredit = 0) {
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
  const customerId = account.customer!.id;
  if (walletCredit > 0) {
    const wallet = await db.wallet.create({ data: { customerId } });
    await db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        transactionType: "MANUAL_ADJUSTMENT",
        direction: "CREDIT",
        amount: BigInt(walletCredit),
        reason: "Test credit",
      },
    });
  }
  const session = await createSession(
    db,
    { accountId: account.id, domain: "CUSTOMER", ttlMs: 30 * MS_PER_DAY },
    { ip: null, userAgent: null },
    now,
  );
  return { customerId, token: session.tokens.accessToken };
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

/** A customer order of 2 × 150 EGP + 50 EGP shipping, optionally paying part from the wallet. */
async function placeOrder(variantId: string, token: string, walletAmount = 0) {
  counter += 1;
  await data(await call(addItem, { token, body: { variantId, quantity: 2 } }));
  const body = {
    address: { recipientName: "Mona", phone: "01012345678", areaId, street: "9 Road 9" },
    walletAmount,
  };
  const quote = await data(await call(validate, { token, body }));
  return data(
    await call(checkout, {
      token,
      key: `o-${counter}`,
      body: { ...body, expectedTotal: quote.total },
    }),
    201,
  );
}

/** COD confirmation (TASK-031), then the staff steps up to Ready for Shipment. */
async function readyForShipment(orderId: string, token: string) {
  const params = { orderId };
  await runInTransaction(
    (tx) => changeOrderStatus(tx, { orderId, to: "NEW", actor: SYSTEM_ACTOR, now: new Date() }),
    {},
    db,
  );
  await data(await call(confirm, { token, params }));
  await data(await call(startPreparing, { token, params }));
  await data(await call(markReady, { token, params }));
}

async function company(code: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  return db.shippingCompany.create({ data: { code, name: `${code} Express`, status } });
}

let ops: { employeeId: string; token: string };

beforeEach(async () => {
  await resetDatabase();
  const cairo = await db.governorate.findUniqueOrThrow({ where: { code: "C" } });
  areaId = (
    await db.area.create({ data: { governorateId: cairo.id, nameAr: "المعادي", nameEn: "Maadi" } })
  ).id;
  await db.shippingRule.create({ data: { shippingFee: BigInt(5000) } });
  ops = await staff([
    "ORDERS_VIEW",
    "CONFIRM_ORDER",
    "START_PREPARING",
    "MARK_READY_FOR_SHIPMENT",
    "ASSIGN_SHIPPING",
    "MARK_AS_SHIPPED",
    "MANAGE_SHIPMENT",
    "MARK_AS_DELIVERED",
  ]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("carrier handoff and delivery", () => {
  it("assigns the carrier, ships (stock committed, wallet captured) and delivers", async () => {
    const variantId = await product();
    const sara = await customer(10000);
    const order = await placeOrder(variantId, sara.token, 5000);
    const params = { orderId: order.id };
    const aramex = await company("ARAMEX");

    // The carrier can be changed before handoff; the fee stays (Q126, R37).
    const assigned = await data(
      await call(assignShipping, {
        token: ops.token,
        params,
        body: { shippingCompanyId: aramex.id },
      }),
    );
    expect(assigned).toMatchObject({
      shippingFee: 5000,
      shipping: { company: { id: aramex.id, code: "ARAMEX" } },
      shipments: [],
    });

    // Ready for Shipment comes first (R4).
    const early = await call(markShipped, { token: ops.token, params });
    expect(await errorOf(early, 409)).toMatchObject({
      code: "ORDER_STATE_INVALID",
      details: { status: "PENDING_CONFIRMATION", to: "SHIPPED" },
    });

    await readyForShipment(order.id, ops.token);
    const shipped = await data(
      await call(markShipped, { token: ops.token, params, body: { trackingNumber: "AWB-1001" } }),
    );
    expect(shipped).toMatchObject({
      status: "SHIPPED",
      walletAmountReserved: 5000,
      walletAmountCaptured: 5000,
      deliveredAt: null,
      shipments: [
        {
          status: "SHIPPED",
          company: { id: aramex.id },
          trackingNumber: "AWB-1001",
          deliveredAt: null,
          events: [{ type: "SHIPPED" }],
        },
      ],
    });
    const shipmentId = shipped.shipments[0].id as string;

    // Stock leaves the warehouse; the wallet hold becomes a debit (ADR-0025, R38.7).
    const balance = await db.inventoryBalance.findUniqueOrThrow({
      where: { productVariantId: variantId },
    });
    expect([balance.availableQuantity, balance.reservedQuantity]).toEqual([8, 0]);
    expect(await db.inventoryReservation.findMany({ where: { orderId: order.id } })).toMatchObject([
      { status: "CONVERTED" },
    ]);
    expect(
      await db.inventoryMovement.count({
        where: { referenceId: order.id, movementType: "CUSTOMER_ORDER_COMMIT" },
      }),
    ).toBe(1);
    expect(await db.walletReservation.findMany({ where: { orderId: order.id } })).toMatchObject([
      { status: "CAPTURED" },
    ]);
    const wallet = await db.wallet.findUniqueOrThrow({ where: { customerId: sara.customerId } });
    expect(wallet.balance).toBe(BigInt(5000));
    expect(
      await db.walletTransaction.count({
        where: { transactionType: "ORDER_WALLET_USE", referenceId: order.id },
      }),
    ).toBe(1);

    // After handoff the carrier can no longer change; shipping twice is refused.
    const late = await call(assignShipping, {
      token: ops.token,
      params,
      body: { shippingCompanyId: aramex.id },
    });
    expect((await errorOf(late, 409)).code).toBe("ORDER_STATE_INVALID");
    expect((await errorOf(await call(markShipped, { token: ops.token, params }), 409)).code).toBe(
      "ORDER_STATE_INVALID",
    );

    // Out for Delivery comes before Delivered (User Flows §8.2).
    const sParams = { shipmentId };
    const skip = await call(shipmentStatus, {
      token: ops.token,
      params: sParams,
      body: { status: "DELIVERED" },
    });
    expect(await errorOf(skip, 409)).toMatchObject({
      code: "CONFLICT",
      details: { reason: "SHIPMENT_STATE_INVALID", status: "SHIPPED", to: "DELIVERED" },
    });
    const out = await data(
      await call(shipmentStatus, {
        token: ops.token,
        params: sParams,
        body: { status: "OUT_FOR_DELIVERY", location: "Maadi hub", notes: "Driver 7" },
      }),
    );
    expect(out).toMatchObject({
      status: "OUT_FOR_DELIVERY",
      events: [{ type: "SHIPPED" }, { type: "OUT_FOR_DELIVERY", location: "Maadi hub" }],
    });

    // Delivery needs MARK_AS_DELIVERED and moves the order too (R2).
    const courier = await staff(["MANAGE_SHIPMENT"]);
    const denied = await call(shipmentStatus, {
      token: courier.token,
      params: sParams,
      body: { status: "DELIVERED" },
    });
    expect((await errorOf(denied, 403)).code).toBe("PERMISSION_DENIED");
    const delivered = await data(
      await call(shipmentStatus, {
        token: ops.token,
        params: sParams,
        body: { status: "DELIVERED" },
      }),
    );
    expect(delivered).toMatchObject({ status: "DELIVERED", deliveredAt: expect.any(String) });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("DELIVERED");
    expect(after.deliveredAt?.toISOString()).toBe(delivered.deliveredAt);

    // The customer's tracking: statuses and events, no staff notes (Q127).
    const mine = await data(await call(myOrder, { method: "GET", token: sara.token, params }));
    expect(mine.shipments).toEqual([
      {
        status: "DELIVERED",
        company: { name: "ARAMEX Express" },
        trackingNumber: "AWB-1001",
        shippedAt: expect.any(String),
        deliveredAt: delivered.deliveredAt,
        events: [
          { type: "SHIPPED", at: expect.any(String) },
          { type: "OUT_FOR_DELIVERY", at: expect.any(String) },
          { type: "DELIVERED", at: expect.any(String) },
        ],
      },
    ]);

    const audits = await db.auditLog.findMany({
      where: { entityId: { in: [order.id, shipmentId] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(audits.map((a) => a.action)).toEqual([
      "ORDER_SHIPPING_ASSIGNED",
      "ORDER_CONFIRMED",
      "ORDER_PREPARING_STARTED",
      "ORDER_READY_FOR_SHIPMENT",
      "ORDER_SHIPPED",
      "SHIPMENT_STATUS_CHANGED",
      "SHIPMENT_STATUS_CHANGED",
      "ORDER_DELIVERED",
    ]);
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: order.id, eventType: { in: ["ORDER_SHIPPED", "ORDER_DELIVERED"] } },
    });
    expect(events.map((e) => e.eventType).sort()).toEqual(["ORDER_DELIVERED", "ORDER_SHIPPED"]);

    // Shipment history is append-only; shipments are never deleted.
    await expect(
      db.shipmentEvent.updateMany({ where: { shipmentId }, data: { notes: "x" } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.shipment.delete({ where: { id: shipmentId } })).rejects.toThrow(
      /never deleted/,
    );
  });

  it("refuses shipping without an active carrier and rolls everything back", async () => {
    const variantId = await product();
    const sara = await customer();
    const order = await placeOrder(variantId, sara.token);
    const params = { orderId: order.id };
    await readyForShipment(order.id, ops.token);

    const none = await call(markShipped, { token: ops.token, params });
    expect(await errorOf(none, 409)).toMatchObject({
      code: "CONFLICT",
      details: { reason: "SHIPPING_COMPANY_REQUIRED" },
    });
    const still = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(still.status).toBe("READY_FOR_SHIPMENT");
    expect(
      await db.inventoryReservation.count({ where: { orderId: order.id, status: "ACTIVE" } }),
    ).toBe(1);

    const closed = await company("OLD", "INACTIVE");
    const inactive = await call(assignShipping, {
      token: ops.token,
      params,
      body: { shippingCompanyId: closed.id },
    });
    expect((await errorOf(inactive, 400)).details.issues[0]).toMatchObject({
      path: "shippingCompanyId",
      code: "inactive",
    });
    const unknown = await call(assignShipping, {
      token: ops.token,
      params,
      body: { shippingCompanyId: UNKNOWN_ID },
    });
    expect((await errorOf(unknown, 400)).details.issues[0].code).toBe("not_found");
    const noPermission = await staff(["MARK_AS_SHIPPED"]);
    expect(
      (
        await call(assignShipping, {
          token: noPermission.token,
          params,
          body: { shippingCompanyId: closed.id },
        })
      ).status,
    ).toBe(403);
  });
});

describe("tracking numbers", () => {
  it("adds and corrects tracking, unique per company", async () => {
    const variantId = await product();
    const sara = await customer();
    const bosta = await company("BOSTA");
    const ids: string[] = [];
    for (const trackingNumber of ["T-1", undefined]) {
      const order = await placeOrder(variantId, sara.token);
      await data(
        await call(assignShipping, {
          token: ops.token,
          params: { orderId: order.id },
          body: { shippingCompanyId: bosta.id },
        }),
      );
      await readyForShipment(order.id, ops.token);
      const shipped = await data(
        await call(markShipped, {
          token: ops.token,
          params: { orderId: order.id },
          body: trackingNumber ? { trackingNumber } : undefined,
        }),
      );
      ids.push(shipped.shipments[0].id);
    }

    const taken = await call(tracking, {
      token: ops.token,
      params: { shipmentId: ids[1] },
      body: { trackingNumber: "T-1" },
    });
    expect(await errorOf(taken, 409)).toMatchObject({
      details: { reason: "TRACKING_NUMBER_TAKEN" },
    });
    const updated = await data(
      await call(tracking, {
        token: ops.token,
        params: { shipmentId: ids[1] },
        body: { trackingNumber: "T-2" },
      }),
    );
    expect(updated).toMatchObject({
      trackingNumber: "T-2",
      events: [{ type: "SHIPPED" }, { type: "TRACKING_UPDATED" }],
    });
    expect(
      await db.auditLog.findFirst({
        where: { entityId: ids[1], action: "SHIPMENT_TRACKING_UPDATED" },
      }),
    ).toMatchObject({
      previousDataJson: { trackingNumber: null },
      newDataJson: { trackingNumber: "T-2" },
    });

    const invalid = await call(tracking, {
      token: ops.token,
      params: { shipmentId: ids[1] },
      body: { trackingNumber: "has space" },
    });
    expect(invalid.status).toBe(400);
    const missing = await call(tracking, {
      token: ops.token,
      params: { shipmentId: UNKNOWN_ID },
      body: { trackingNumber: "T-3" },
    });
    expect(missing.status).toBe(404);
    const viewer = await staff(["ORDERS_VIEW"]);
    expect(
      (
        await call(tracking, {
          token: viewer.token,
          params: { shipmentId: ids[1] },
          body: { trackingNumber: "T-4" },
        })
      ).status,
    ).toBe(403);
  });
});

/** A customer order handed to an active carrier; returns the order, customer and shipment. */
async function shippedOrder(walletCredit = 0, walletAmount = 0) {
  const variantId = await product();
  const sara = await customer(walletCredit);
  const order = await placeOrder(variantId, sara.token, walletAmount);
  counter += 1;
  const carrier = await company(`CARRIER${counter}`);
  await data(
    await call(assignShipping, {
      token: ops.token,
      params: { orderId: order.id },
      body: { shippingCompanyId: carrier.id },
    }),
  );
  await readyForShipment(order.id, ops.token);
  const shipped = await data(
    await call(markShipped, { token: ops.token, params: { orderId: order.id } }),
  );
  return { order, sara, variantId, shipmentId: shipped.shipments[0].id as string };
}

async function move(shipmentId: string, status: string, extra: Record<string, string> = {}) {
  return call(shipmentStatus, {
    token: ops.token,
    params: { shipmentId },
    body: { status, ...extra },
  });
}

describe("delivery failures and contact tasks (TASK-035, Q19, Q128, Q129)", () => {
  it("counts failed attempts, keeps the order shipped and opens one task at the threshold", async () => {
    const { order, sara, shipmentId } = await shippedOrder();
    const agent = await staff(["CONTACT_TASK_MANAGE"]);

    // A failure needs an attempt first (User Flows §10).
    expect(await errorOf(await move(shipmentId, "DELIVERY_FAILED"), 409)).toMatchObject({
      details: { reason: "SHIPMENT_STATE_INVALID", status: "SHIPPED", to: "DELIVERY_FAILED" },
    });

    await data(await move(shipmentId, "OUT_FOR_DELIVERY"));
    const first = await data(
      await move(shipmentId, "DELIVERY_FAILED", { notes: "No answer", location: "Maadi" }),
    );
    expect(first).toMatchObject({ status: "DELIVERY_FAILED", attemptCount: 1 });
    // One failure is not a cancellation (Q128); below the default threshold of 2, no task.
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SHIPPED");
    expect(await db.customerContactTask.count()).toBe(0);
    expect(await data(await call(listTasks, { method: "GET", token: agent.token }))).toEqual([]);

    // Another attempt, another failure: the threshold opens a task (Q129).
    await data(await move(shipmentId, "OUT_FOR_DELIVERY"));
    const second = await data(await move(shipmentId, "DELIVERY_FAILED"));
    expect(second.attemptCount).toBe(2);
    const tasks = await data(await call(listTasks, { method: "GET", token: agent.token }));
    expect(tasks).toMatchObject([
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        shipmentId,
        attemptCount: 2,
        reason: "DELIVERY_FAILED_THRESHOLD",
        status: "OPEN",
        assignedEmployee: null,
        resolvedAt: null,
      },
    ]);
    const taskId = tasks[0].id as string;

    // A further failure while the task is open does not open a second one.
    await data(await move(shipmentId, "OUT_FOR_DELIVERY"));
    expect((await data(await move(shipmentId, "DELIVERY_FAILED"))).attemptCount).toBe(3);
    expect(await db.customerContactTask.count()).toBe(1);

    // Staff assign, record the outcome and resolve.
    const assigned = await data(
      await call(updateTask, {
        method: "PATCH",
        token: agent.token,
        params: { taskId },
        body: { assignedEmployeeId: agent.employeeId, status: "IN_PROGRESS" },
      }),
    );
    expect(assigned).toMatchObject({
      status: "IN_PROGRESS",
      assignedEmployee: { id: agent.employeeId },
    });
    const resolved = await data(
      await call(updateTask, {
        method: "PATCH",
        token: agent.token,
        params: { taskId },
        body: { status: "RESOLVED", outcomeNotes: "Customer at home after 6 pm" },
      }),
    );
    expect(resolved).toMatchObject({
      status: "RESOLVED",
      outcomeNotes: "Customer at home after 6 pm",
      resolvedAt: expect.any(String),
      resolvedBy: { id: agent.employeeId },
    });
    const closed = await call(updateTask, {
      method: "PATCH",
      token: agent.token,
      params: { taskId },
      body: { outcomeNotes: "late" },
    });
    expect(await errorOf(closed, 409)).toMatchObject({
      details: { reason: "CONTACT_TASK_CLOSED", status: "RESOLVED" },
    });

    // Once the task is closed, the next failure opens a new one.
    await data(await move(shipmentId, "OUT_FOR_DELIVERY"));
    await data(await move(shipmentId, "DELIVERY_FAILED"));
    expect(
      await data(
        await call(listTasks, { method: "GET", token: agent.token, query: { status: "OPEN" } }),
      ),
    ).toMatchObject([{ attemptCount: 4, status: "OPEN" }]);

    // A later attempt can still deliver.
    await data(await move(shipmentId, "OUT_FOR_DELIVERY"));
    expect((await data(await move(shipmentId, "DELIVERED"))).attemptCount).toBe(4);

    // Customers see the failed attempts in tracking, without notes (Q127).
    const mine = await data(
      await call(myOrder, { method: "GET", token: sara.token, params: { orderId: order.id } }),
    );
    expect(mine.shipments[0].events.map((e: { type: string }) => e.type)).toEqual([
      "SHIPPED",
      "OUT_FOR_DELIVERY",
      "DELIVERY_FAILED",
      "OUT_FOR_DELIVERY",
      "DELIVERY_FAILED",
      "OUT_FOR_DELIVERY",
      "DELIVERY_FAILED",
      "OUT_FOR_DELIVERY",
      "DELIVERY_FAILED",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
    expect(mine.shipments[0].events[2]).toEqual({
      type: "DELIVERY_FAILED",
      at: expect.any(String),
    });

    const audits = await db.auditLog.findMany({
      where: { action: { in: ["CONTACT_TASK_CREATED", "CONTACT_TASK_UPDATED"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(audits.map((a) => [a.action, a.actorType])).toEqual([
      ["CONTACT_TASK_CREATED", "SYSTEM"],
      ["CONTACT_TASK_UPDATED", "EMPLOYEE"],
      ["CONTACT_TASK_UPDATED", "EMPLOYEE"],
      ["CONTACT_TASK_CREATED", "SYSTEM"],
    ]);
    expect(
      await db.auditLog.findFirst({
        where: { entityId: shipmentId, action: "SHIPMENT_STATUS_CHANGED" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: 1,
      }),
    ).toMatchObject({ newDataJson: { status: "DELIVERY_FAILED", attemptCount: 1 } });

    // Tasks are never deleted.
    await expect(db.customerContactTask.delete({ where: { id: taskId } })).rejects.toThrow(
      /never deleted/,
    );
  });

  it("uses the configured threshold and checks task updates", async () => {
    await db.setting.create({
      data: {
        key: "shipping.delivery_failure_contact_threshold",
        valueJson: 1,
        dataType: "INTEGER",
      },
    });
    const { shipmentId } = await shippedOrder();
    await data(await move(shipmentId, "OUT_FOR_DELIVERY"));
    await data(await move(shipmentId, "DELIVERY_FAILED"));
    const task = await db.customerContactTask.findFirstOrThrow({ where: { shipmentId } });

    const agent = await staff(["CONTACT_TASK_MANAGE"]);
    const patch = (body: unknown, token = agent.token, taskId = task.id) =>
      call(updateTask, { method: "PATCH", token, params: { taskId }, body });

    expect((await errorOf(await patch({}), 400)).code).toBe("VALIDATION_ERROR");
    expect((await errorOf(await patch({ status: "OPEN" }), 400)).code).toBe("VALIDATION_ERROR");
    expect(
      (await errorOf(await patch({ assignedEmployeeId: UNKNOWN_ID }), 400)).details.issues[0],
    ).toMatchObject({ path: "assignedEmployeeId", code: "not_found" });
    expect(
      (await errorOf(await patch({ status: "CANCELLED" }, agent.token, UNKNOWN_ID), 404)).code,
    ).toBe("NOT_FOUND");
    const viewer = await staff(["ORDERS_VIEW"]);
    expect((await patch({ status: "CANCELLED" }, viewer.token)).status).toBe(403);
    expect((await call(listTasks, { method: "GET", token: viewer.token })).status).toBe(403);

    const cancelled = await data(await patch({ status: "CANCELLED" }));
    expect(cancelled).toMatchObject({ status: "CANCELLED", resolvedBy: { id: agent.employeeId } });
  });
});
