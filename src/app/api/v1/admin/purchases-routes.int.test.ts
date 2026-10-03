import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approveRequest } from "@/app/api/v1/admin/approval-requests/[id]/approve/route";
import { POST as approvePurchase } from "@/app/api/v1/admin/purchases/[id]/approve/route";
import { POST as cancelPurchase } from "@/app/api/v1/admin/purchases/[id]/cancel/route";
import { POST as rejectPurchase } from "@/app/api/v1/admin/purchases/[id]/reject/route";
import {
  GET as getPurchase,
  PATCH as patchPurchase,
} from "@/app/api/v1/admin/purchases/[id]/route";
import { POST as sendPurchase } from "@/app/api/v1/admin/purchases/[id]/send/route";
import { POST as submitPurchase } from "@/app/api/v1/admin/purchases/[id]/submit/route";
import { GET as listPurchases, POST as createPurchase } from "@/app/api/v1/admin/purchases/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of the admin purchase order endpoints (API §21, "TASK-022 Amendments"). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const SAME_ORIGIN = "http://localhost";
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    token?: string;
    headers?: Record<string, string>;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
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

let counter = 0;

/** An employee with a live session; returns its Bearer access token. */
async function staff(level: EmployeeLevel, codes: PermissionCode[] = []) {
  counter += 1;
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `purchase${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: {
        create: {
          displayName: `Staff ${counter}`,
          employeeLevel: level,
          roles:
            codes.length > 0
              ? {
                  create: [
                    {
                      role: {
                        create: {
                          name: `Role ${counter}`,
                          permissions: {
                            create: permissions.map((p) => ({ permissionId: p.id })),
                          },
                        },
                      },
                    },
                  ],
                }
              : undefined,
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
  return { employee: account.employee!, token: created.tokens.accessToken };
}

async function data(res: Response, status = 200) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data;
}

/** The Purchasing Manager default role (permission catalog §3). */
const PURCHASING: PermissionCode[] = ["SUPPLIER_VIEW", "PURCHASE_VIEW", "PURCHASE_CREATE"];

async function supplier(status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  counter += 1;
  return db.supplier.create({ data: { name: `Supplier ${counter}`, status } });
}

async function variant(archived = false) {
  counter += 1;
  const product = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      ...(archived ? { status: "ARCHIVED", archivedAt: new Date() } : {}),
      variants: { create: { sku: `SKU-${counter}`, isDefault: true } },
    },
    include: { variants: true },
  });
  return product.variants[0];
}

function act(handler: unknown, id: string, token: string, body?: unknown) {
  return call(handler, `/admin/purchases/${id}`, { method: "POST", token, body, params: { id } });
}

function get(id: string, token: string) {
  return call(getPurchase, `/admin/purchases/${id}`, { token, params: { id } });
}

async function draft(token: string, supplierId: string, items: unknown[]) {
  return data(
    await call(createPurchase, "/admin/purchases", {
      method: "POST",
      token,
      body: { supplierId, items },
    }),
    201,
  );
}

async function reasonOf(res: Response, status: number) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.error.details.reason;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("purchase orders", () => {
  it("guards each endpoint with its permission", async () => {
    expect((await call(listPurchases, "/admin/purchases")).status).toBe(401);
    const viewer = await staff("MANAGER", ["PURCHASE_VIEW"]);
    const buyer = await staff("MANAGER", PURCHASING);
    // A Manager's role cannot carry PURCHASE_APPROVE (Owner/Admin only).
    const wouldBeApprover = await staff("MANAGER", [...PURCHASING, "PURCHASE_APPROVE"]);
    const acme = await supplier();
    const v = await variant();
    const po = await draft(buyer.token, acme.id, [{ variantId: v.id, quantity: 2, unitCost: 500 }]);

    expect((await call(listPurchases, "/admin/purchases", { token: viewer.token })).status).toBe(
      200,
    );
    expect((await get(po.id, viewer.token)).status).toBe(200);
    const create = await call(createPurchase, "/admin/purchases", {
      method: "POST",
      token: viewer.token,
      body: { supplierId: acme.id, items: [{ variantId: v.id, quantity: 1, unitCost: 1 }] },
    });
    expect(create.status).toBe(403);
    expect((await act(submitPurchase, po.id, viewer.token)).status).toBe(403);
    await data(await act(submitPurchase, po.id, buyer.token));
    expect((await act(approvePurchase, po.id, buyer.token)).status).toBe(403);
    expect((await act(approvePurchase, po.id, wouldBeApprover.token)).status).toBe(403);
    expect((await act(rejectPurchase, po.id, buyer.token, { reason: "No" })).status).toBe(403);
  });

  it("requires the Origin check for cookie-authenticated writes", async () => {
    const owner = await staff("OWNER");
    const acme = await supplier();
    const v = await variant();
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    const write = (headers: Record<string, string>) =>
      call(createPurchase, "/admin/purchases", {
        method: "POST",
        headers,
        body: { supplierId: acme.id, items: [{ variantId: v.id, quantity: 1, unitCost: 100 }] },
      });
    expect((await write({ cookie })).status).toBe(403);
    expect((await write({ cookie, origin: SAME_ORIGIN })).status).toBe(201);
  });

  it("goes Draft → Pending → rejected → resubmitted → Approved → Sent, audited, without stock", async () => {
    const owner = await staff("OWNER");
    const buyer = await staff("MANAGER", PURCHASING);
    const acme = await supplier();
    const a = await variant();
    const b = await variant();

    const po = await draft(buyer.token, acme.id, [
      { variantId: a.id, quantity: 10, unitCost: 1250 },
      { variantId: b.id, quantity: 3, unitCost: 999 },
    ]);
    expect(po).toMatchObject({
      status: "DRAFT",
      purchaseNumber: expect.stringMatching(/^PO-\d{6}$/),
      supplier: { id: acme.id, name: acme.name },
      orderedTotal: 10 * 1250 + 3 * 999,
      currency: "EGP",
      createdBy: { id: buyer.employee.id },
      approval: null,
    });
    expect(po.items).toHaveLength(2);
    expect(po.items[0]).toMatchObject({ variantId: a.id, orderedQuantity: 10, lineTotal: 12500 });

    const edit = (body: unknown) =>
      call(patchPurchase, `/admin/purchases/${po.id}`, {
        method: "PATCH",
        token: buyer.token,
        body,
        params: { id: po.id },
      });
    const edited = await data(
      await edit({
        notes: "Ramadan stock",
        items: [{ variantId: a.id, quantity: 4, unitCost: 1000 }],
      }),
    );
    expect(edited).toMatchObject({ notes: "Ramadan stock", orderedTotal: 4000 });
    expect(edited.items).toHaveLength(1);
    // Same values again: no write, no audit entry.
    await data(await edit({ notes: "Ramadan stock" }));

    const pending = await data(await act(submitPurchase, po.id, buyer.token, { reason: "Urgent" }));
    expect(pending).toMatchObject({ status: "PENDING_APPROVAL", approval: { status: "PENDING" } });
    expect(await reasonOf(await edit({ notes: "late" }), 409)).toBe("PURCHASE_STATUS_INVALID");
    expect((await act(rejectPurchase, po.id, owner.token, {})).status).toBe(400);

    const rejected = await data(
      await act(rejectPurchase, po.id, owner.token, { reason: "Cost too high" }),
    );
    expect(rejected).toMatchObject({
      status: "DRAFT",
      submittedAt: null,
      approval: { status: "REJECTED", resolutionReason: "Cost too high" },
    });
    await data(await edit({ items: [{ variantId: a.id, quantity: 4, unitCost: 900 }] }));
    await data(await act(submitPurchase, po.id, buyer.token));

    const approved = await data(await act(approvePurchase, po.id, owner.token, { reason: "OK" }));
    expect(approved).toMatchObject({
      status: "APPROVED",
      approvedBy: { id: owner.employee.id },
      approval: { status: "APPROVED" },
    });
    expect(await reasonOf(await act(approvePurchase, po.id, owner.token), 409)).toBe(
      "PURCHASE_STATUS_INVALID",
    );
    const sent = await data(await act(sendPurchase, po.id, buyer.token));
    expect(sent.status).toBe("SENT");
    expect(sent.sentAt).not.toBeNull();
    expect(await reasonOf(await act(sendPurchase, po.id, buyer.token), 409)).toBe(
      "PURCHASE_STATUS_INVALID",
    );

    const audits = await db.auditLog.findMany({
      where: { entityType: "PURCHASE_ORDER", entityId: po.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(audits.map((entry) => entry.action)).toEqual([
      "PURCHASE_ORDER_CREATED",
      "PURCHASE_ORDER_UPDATED",
      "PURCHASE_ORDER_SUBMITTED",
      "PURCHASE_ORDER_REJECTED",
      "PURCHASE_ORDER_UPDATED",
      "PURCHASE_ORDER_SUBMITTED",
      "PURCHASE_ORDER_APPROVED",
      "PURCHASE_ORDER_SENT",
    ]);
    expect(audits[3].reason).toBe("Cost too high");

    // Q101: a purchase order never changes stock.
    expect(await db.inventoryMovement.count()).toBe(0);

    const list = await (
      await call(listPurchases, `/admin/purchases?status=SENT&search=${po.purchaseNumber}`, {
        token: buyer.token,
      })
    ).json();
    expect(list.data.map((p: { id: string }) => p.id)).toEqual([po.id]);
    expect(list.meta.pagination.total).toBe(1);
  });

  it("approves an Owner/Admin's own order on submit and resolves through the approval list", async () => {
    const owner = await staff("OWNER");
    const admin = await staff("ADMIN");
    const buyer = await staff("MANAGER", PURCHASING);
    const acme = await supplier();
    const v = await variant();
    const line = { variantId: v.id, quantity: 1, unitCost: 100 };

    const own = await draft(admin.token, acme.id, [line]);
    const done = await data(await act(submitPurchase, own.id, admin.token));
    expect(done).toMatchObject({ status: "APPROVED", approvedBy: { id: admin.employee.id } });
    expect(await db.approvalRequest.count()).toBe(0);

    const po = await draft(buyer.token, acme.id, [line]);
    const pending = await data(await act(submitPurchase, po.id, buyer.token));
    const requestId = pending.approval.id;
    const res = await call(approveRequest, `/admin/approval-requests/${requestId}/approve`, {
      method: "POST",
      token: owner.token,
      params: { id: requestId },
    });
    expect(res.status).toBe(200);
    expect(await data(await get(po.id, buyer.token))).toMatchObject({
      status: "APPROVED",
      approvedBy: { id: owner.employee.id },
    });
  });

  it("refuses inactive suppliers, archived variants, bad input and unknown ids", async () => {
    const owner = await staff("OWNER");
    const acme = await supplier();
    const closed = await supplier("INACTIVE");
    const v = await variant();
    const archived = await variant(true);
    const post = (body: unknown) =>
      call(createPurchase, "/admin/purchases", { method: "POST", token: owner.token, body });
    const line = { variantId: v.id, quantity: 1, unitCost: 100 };

    expect(await reasonOf(await post({ supplierId: closed.id, items: [line] }), 409)).toBe(
      "SUPPLIER_INACTIVE",
    );
    expect(
      await reasonOf(
        await post({ supplierId: acme.id, items: [{ ...line, variantId: archived.id }] }),
        409,
      ),
    ).toBe("VARIANT_ARCHIVED");
    for (const body of [
      {},
      { supplierId: acme.id, items: [] },
      { supplierId: UNKNOWN_ID, items: [line] },
      { supplierId: acme.id, items: [{ ...line, variantId: UNKNOWN_ID }] },
      { supplierId: acme.id, items: [line, line] },
      { supplierId: acme.id, items: [{ ...line, quantity: 0 }] },
      { supplierId: acme.id, items: [{ ...line, unitCost: 0 }] },
      { supplierId: acme.id, items: [{ ...line, unitCost: 1.5 }] },
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }

    // A supplier deactivated after the draft blocks the submit.
    const po = await draft(owner.token, acme.id, [line]);
    await db.supplier.update({ where: { id: acme.id }, data: { status: "INACTIVE" } });
    expect(await reasonOf(await act(submitPurchase, po.id, owner.token), 409)).toBe(
      "SUPPLIER_INACTIVE",
    );
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      expect((await get(id, owner.token)).status).toBe(404);
      expect((await act(submitPurchase, id, owner.token)).status).toBe(404);
    }
  });

  it("cancels before receiving; approved orders need PURCHASE_APPROVE", async () => {
    const owner = await staff("OWNER");
    const buyer = await staff("MANAGER", PURCHASING);
    const acme = await supplier();
    const v = await variant();
    const line = { variantId: v.id, quantity: 1, unitCost: 100 };

    const pending = await draft(buyer.token, acme.id, [line]);
    await data(await act(submitPurchase, pending.id, buyer.token));
    expect((await act(cancelPurchase, pending.id, buyer.token, {})).status).toBe(400);
    const cancelled = await data(
      await act(cancelPurchase, pending.id, buyer.token, { reason: "Wrong supplier" }),
    );
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      cancelledBy: { id: buyer.employee.id },
      cancellationReason: "Wrong supplier",
      approval: { status: "CANCELLED" },
    });
    expect(
      await reasonOf(await act(cancelPurchase, pending.id, owner.token, { reason: "again" }), 409),
    ).toBe("PURCHASE_STATUS_INVALID");

    const approved = await draft(buyer.token, acme.id, [line]);
    await data(await act(submitPurchase, approved.id, buyer.token));
    await data(await act(approvePurchase, approved.id, owner.token));
    expect(
      await reasonOf(await act(cancelPurchase, approved.id, buyer.token, { reason: "x" }), 403),
    ).toBe("PURCHASE_APPROVE_REQUIRED");
    const byOwner = await data(
      await act(cancelPurchase, approved.id, owner.token, { reason: "Supplier out of stock" }),
    );
    expect(byOwner.status).toBe("CANCELLED");
  });

  it("never deletes an order and freezes its lines once submitted", async () => {
    const owner = await staff("OWNER");
    const acme = await supplier();
    const v = await variant();
    const other = await variant();
    const po = await draft(owner.token, acme.id, [{ variantId: v.id, quantity: 2, unitCost: 100 }]);
    await data(await act(submitPurchase, po.id, owner.token));

    await expect(db.purchaseOrder.delete({ where: { id: po.id } })).rejects.toThrow();
    await expect(
      db.purchaseItem.updateMany({
        where: { purchaseOrderId: po.id },
        data: { orderedQuantity: 3, lineTotal: BigInt(300) },
      }),
    ).rejects.toThrow();
    await expect(
      db.purchaseItem.create({
        data: {
          purchaseOrderId: po.id,
          productVariantId: other.id,
          orderedQuantity: 1,
          unitCost: BigInt(1),
          lineTotal: BigInt(1),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.purchaseItem.deleteMany({ where: { purchaseOrderId: po.id } }),
    ).rejects.toThrow();
  });
});
