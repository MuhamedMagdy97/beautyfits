import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approveRequest } from "@/app/api/v1/admin/approval-requests/[id]/approve/route";
import { POST as rejectRequest } from "@/app/api/v1/admin/approval-requests/[id]/reject/route";
import { POST as recordInvoice } from "@/app/api/v1/admin/purchases/[id]/invoice/route";
import { POST as receivePurchase } from "@/app/api/v1/admin/purchases/[id]/receive/route";
import { POST as submitPurchase } from "@/app/api/v1/admin/purchases/[id]/submit/route";
import { POST as createReturn } from "@/app/api/v1/admin/purchases/[id]/supplier-return/route";
import { POST as createPurchase } from "@/app/api/v1/admin/purchases/route";
import { GET as getReturn } from "@/app/api/v1/admin/supplier-returns/[id]/route";
import { POST as settleReturn } from "@/app/api/v1/admin/supplier-returns/[id]/settle/route";
import { POST as submitReturn } from "@/app/api/v1/admin/supplier-returns/[id]/submit/route";
import { GET as listReturns } from "@/app/api/v1/admin/supplier-returns/route";
import { GET as getBalance } from "@/app/api/v1/admin/suppliers/[id]/balance/route";
import { GET as getLedger } from "@/app/api/v1/admin/suppliers/[id]/ledger/route";
import { POST as recordPayment } from "@/app/api/v1/admin/suppliers/[id]/payments/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of supplier returns, payments and the supplier ledger (TASK-024, ADR-0029). */

const db = getDb();
const BASE = "http://localhost/api/v1";

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

async function staff(level: EmployeeLevel, codes: PermissionCode[] = []) {
  counter += 1;
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `finance${counter}@beautyfits.example`,
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

async function errorOf(res: Response, status: number) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.error;
}

/** Default roles of the permission catalog §3. */
const PURCHASING: PermissionCode[] = [
  "SUPPLIER_VIEW",
  "PURCHASE_VIEW",
  "PURCHASE_CREATE",
  "SUPPLIER_RETURN_MANAGE",
  "SUPPLIER_FINANCE_VIEW",
];
const WAREHOUSE: PermissionCode[] = ["INVENTORY_VIEW", "RECEIVE_PURCHASE"];
const PAYMENTS: PermissionCode[] = ["SUPPLIER_PAYMENT_MANAGE"];

async function variant() {
  counter += 1;
  const product = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      variants: { create: { sku: `SKU-${counter}`, isDefault: true } },
    },
    include: { variants: true },
  });
  return product.variants[0];
}

function post(handler: unknown, path: string, id: string, token: string, body?: unknown) {
  return call(handler, path, { method: "POST", token, body, params: { id } });
}

async function supplier() {
  counter += 1;
  return db.supplier.create({ data: { name: `Supplier ${counter}` } });
}

/** An approved order of 10 units at 1000 piastres, received with 3 damaged. */
async function receivedWithDamage(ownerToken: string, warehouseToken: string, supplierId?: string) {
  const v = await variant();
  const supplierRow = supplierId ? { id: supplierId } : await supplier();
  const created = await data(
    await call(createPurchase, "/admin/purchases", {
      method: "POST",
      token: ownerToken,
      body: {
        supplierId: supplierRow.id,
        items: [{ variantId: v.id, quantity: 10, unitCost: 1000 }],
      },
    }),
    201,
  );
  const po = await data(
    await post(submitPurchase, "/admin/purchases/x/submit", created.id, ownerToken),
  );
  const received = await data(
    await call(receivePurchase, `/admin/purchases/${po.id}/receive`, {
      method: "POST",
      token: warehouseToken,
      params: { id: po.id },
      headers: { "idempotency-key": randomUUID() },
      body: {
        items: [
          {
            purchaseItemId: po.items[0].id,
            deliveredQuantity: 10,
            damagedQuantity: 3,
            notes: "3 crushed",
          },
        ],
      },
    }),
    201,
  );
  return {
    po,
    variant: v,
    supplierId: supplierRow.id,
    receiptItemId: (
      await db.goodsReceiptItem.findFirstOrThrow({ where: { goodsReceiptId: received.receipt.id } })
    ).id,
  };
}

async function invoiceFor(purchaseId: string, token: string, invoiceTotal: number) {
  counter += 1;
  const file = await db.mediaAsset.create({
    data: {
      storageProvider: "LOCAL",
      objectKey: `test/${counter}.png`,
      originalFilename: "invoice.png",
      mimeType: "image/png",
      sizeBytes: 100,
      width: 800,
      height: 1000,
      checksum: "0".repeat(64),
      purpose: "SUPPLIER_INVOICE",
      scanStatus: "SAFE",
      uploadExpiresAt: new Date(),
      completedAt: new Date(),
    },
  });
  return data(
    await post(recordInvoice, "/admin/purchases/x/invoice", purchaseId, token, {
      invoiceNumber: `INV-${counter}`,
      invoiceDate: "2026-10-01",
      invoiceTotal,
      mediaAssetId: file.id,
    }),
    201,
  );
}

function newReturn(purchaseId: string, token: string, items: unknown[], reason = "Crushed boxes") {
  return post(createReturn, "/admin/purchases/x/supplier-return", purchaseId, token, {
    reason,
    items,
  });
}

function settle(returnId: string, token: string, body: unknown) {
  return post(settleReturn, "/admin/supplier-returns/x/settle", returnId, token, body);
}

function pay(supplierId: string, token: string, body: unknown, key: string | null = randomUUID()) {
  return call(recordPayment, `/admin/suppliers/${supplierId}/payments`, {
    method: "POST",
    token,
    body,
    params: { id: supplierId },
    headers: key === null ? {} : { "idempotency-key": key },
  });
}

function balanceOf(supplierId: string, token: string) {
  return call(getBalance, `/admin/suppliers/${supplierId}/balance`, {
    token,
    params: { id: supplierId },
  });
}

async function damaged(variantId: string) {
  return (await db.inventoryBalance.findUniqueOrThrow({ where: { productVariantId: variantId } }))
    .damagedQuantity;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("supplier returns", () => {
  it("guards each endpoint with its permission", async () => {
    const owner = await staff("OWNER");
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const buyer = await staff("MANAGER", PURCHASING);
    const { po, receiptItemId, supplierId } = await receivedWithDamage(
      owner.token,
      warehouse.token,
    );
    const line = { goodsReceiptItemId: receiptItemId, quantity: 1 };

    expect((await newReturn(po.id, "", [line])).status).toBe(401);
    expect((await newReturn(po.id, warehouse.token, [line])).status).toBe(403);
    const draft = await data(await newReturn(po.id, buyer.token, [line]), 201);
    expect((await settle(draft.id, buyer.token, { resolution: "CREDIT" })).status).toBe(403);
    expect(
      (await call(listReturns, "/admin/supplier-returns", { token: warehouse.token })).status,
    ).toBe(403);
    expect((await balanceOf(supplierId, warehouse.token)).status).toBe(403);
    expect(
      (await pay(supplierId, buyer.token, { amount: 1, method: "CASH", paidOn: "2026-10-03" }))
        .status,
    ).toBe(403);
    const payer = await staff("EMPLOYEE", PAYMENTS);
    const noKey = await errorOf(
      await pay(supplierId, payer.token, { amount: 1, method: "CASH", paidOn: "2026-10-03" }, null),
      400,
    );
    expect(noKey.details.issues[0].code).toBe("idempotency_key_required");
  });

  it("returns damaged units after Owner review and settles them as a credit (Q105-Q107, Q120)", async () => {
    const owner = await staff("OWNER");
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const buyer = await staff("MANAGER", PURCHASING);
    const finance = await staff("EMPLOYEE", [...PAYMENTS, "SUPPLIER_FINANCE_VIEW"]);
    const {
      po,
      variant: v,
      receiptItemId,
      supplierId,
    } = await receivedWithDamage(owner.token, warehouse.token);
    await invoiceFor(po.id, finance.token, 10_000);
    expect(await damaged(v.id)).toBe(3);

    const tooMany = await errorOf(
      await newReturn(po.id, buyer.token, [{ goodsReceiptItemId: receiptItemId, quantity: 4 }]),
      400,
    );
    expect(tooMany.details.issues[0].code).toBe("quantity_exceeds_returnable");
    const foreign = await errorOf(
      await newReturn(po.id, buyer.token, [{ goodsReceiptItemId: randomUUID(), quantity: 1 }]),
      400,
    );
    expect(foreign.details.issues[0].code).toBe("goods_receipt_item_not_found");

    const draft = await data(
      await newReturn(po.id, buyer.token, [{ goodsReceiptItemId: receiptItemId, quantity: 2 }]),
      201,
    );
    expect(draft).toMatchObject({
      returnNumber: "SR-000001",
      status: "DRAFT",
      expectedAmount: 2000,
      purchase: { id: po.id },
      supplier: { id: supplierId },
    });
    expect(draft.items[0]).toMatchObject({ quantity: 2, unitCost: 1000, lineTotal: 2000 });
    expect((await settle(draft.id, finance.token, { resolution: "CREDIT" })).status).toBe(409);

    const pending = await data(
      await post(submitReturn, "/admin/supplier-returns/x/submit", draft.id, buyer.token),
    );
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect(pending.approval.status).toBe("PENDING");
    expect(await damaged(v.id)).toBe(3);

    await data(
      await post(
        approveRequest,
        "/admin/approval-requests/x/approve",
        pending.approval.id,
        owner.token,
        {},
      ),
    );
    const approved = await data(
      await call(getReturn, `/admin/supplier-returns/${draft.id}`, {
        token: finance.token,
        params: { id: draft.id },
      }),
    );
    expect(approved).toMatchObject({ status: "APPROVED", approvedBy: { id: owner.employee.id } });
    expect(await damaged(v.id)).toBe(1);
    const movement = await db.inventoryMovement.findFirstOrThrow({
      where: { productVariantId: v.id, movementType: "SUPPLIER_RETURN" },
    });
    expect(movement).toMatchObject({
      damagedDelta: -2,
      availableDelta: 0,
      unitCost: BigInt(1000),
      referenceType: "SUPPLIER_RETURN",
      referenceId: draft.id,
    });

    // Only 1 damaged unit is left to return.
    const rest = await errorOf(
      await newReturn(po.id, buyer.token, [{ goodsReceiptItemId: receiptItemId, quantity: 2 }]),
      400,
    );
    expect(rest.details.issues[0].code).toBe("quantity_exceeds_returnable");

    const settled = await data(await settle(draft.id, finance.token, { resolution: "CREDIT" }));
    expect(settled).toMatchObject({
      status: "SETTLED",
      financialResolution: "CREDIT",
      financialAmount: 2000,
      settledBy: { id: finance.employee.id },
    });
    const again = await errorOf(
      await settle(draft.id, finance.token, { resolution: "CREDIT" }),
      409,
    );
    expect(again.details.reason).toBe("SUPPLIER_RETURN_STATUS_INVALID");

    const balance = await data(await balanceOf(supplierId, finance.token));
    expect(balance).toMatchObject({
      balance: 8000,
      totals: { invoiced: 10_000, paid: 0, credited: 2000, refunded: 0 },
      purchases: [{ id: po.id, invoiced: 10_000, balance: 8000, paymentStatus: "UNPAID" }],
    });
    const ledger = await data(
      await call(getLedger, `/admin/suppliers/${supplierId}/ledger`, {
        token: finance.token,
        params: { id: supplierId },
      }),
    );
    expect(
      ledger.map((e: { entryType: string; signedAmount: number }) => [e.entryType, e.signedAmount]),
    ).toEqual([
      ["CREDIT", -2000],
      ["INVOICE", 10_000],
    ]);
    expect(ledger[0].supplierReturn).toEqual({ id: draft.id, returnNumber: "SR-000001" });

    const actions = (
      await db.auditLog.findMany({ where: { entityId: draft.id }, orderBy: { createdAt: "asc" } })
    ).map((log) => log.action);
    expect(actions).toEqual([
      "SUPPLIER_RETURN_CREATED",
      "SUPPLIER_RETURN_SUBMITTED",
      "SUPPLIER_RETURN_APPROVED",
      "SUPPLIER_RETURN_SETTLED",
    ]);
  });

  it("approves an Owner's return at once; refunds net to zero; OTHER moves no money", async () => {
    const owner = await staff("OWNER");
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const {
      po,
      variant: v,
      receiptItemId,
      supplierId,
    } = await receivedWithDamage(owner.token, warehouse.token);
    await invoiceFor(po.id, owner.token, 10_000);

    const draft = await data(
      await newReturn(po.id, owner.token, [{ goodsReceiptItemId: receiptItemId, quantity: 2 }]),
      201,
    );
    const approved = await data(
      await post(submitReturn, "/admin/supplier-returns/x/submit", draft.id, owner.token, {}),
    );
    expect(approved).toMatchObject({ status: "APPROVED", approval: null });
    expect(await damaged(v.id)).toBe(1);

    const unexplained = await errorOf(
      await settle(draft.id, owner.token, { resolution: "REFUND", amount: 1500 }),
      400,
    );
    expect(unexplained.details.issues[0].code).toBe("notes_required");
    await data(
      await settle(draft.id, owner.token, {
        resolution: "REFUND",
        amount: 1500,
        notes: "Supplier kept 500 for handling",
      }),
    );
    const entries = await db.supplierLedgerEntry.findMany({
      where: { supplierReturnId: draft.id },
      orderBy: { entryType: "asc" },
    });
    expect(entries.map((e) => [e.entryType, e.direction, e.amount])).toEqual([
      ["CREDIT", "DEBIT", BigInt(1500)],
      ["REFUND", "CREDIT", BigInt(1500)],
    ]);
    expect((await data(await balanceOf(supplierId, owner.token))).balance).toBe(10_000);

    const other = await data(
      await newReturn(po.id, owner.token, [{ goodsReceiptItemId: receiptItemId, quantity: 1 }]),
      201,
    );
    await data(await post(submitReturn, "/admin/supplier-returns/x/submit", other.id, owner.token));
    expect(
      (await errorOf(await settle(other.id, owner.token, { resolution: "OTHER", amount: 5 }), 400))
        .details.issues[0].code,
    ).toBe("amount_not_allowed");
    expect(
      (await errorOf(await settle(other.id, owner.token, { resolution: "OTHER" }), 400)).details
        .issues[0].code,
    ).toBe("notes_required");
    const replaced = await data(
      await settle(other.id, owner.token, {
        resolution: "OTHER",
        notes: "Replaced with new stock",
      }),
    );
    expect(replaced).toMatchObject({ financialResolution: "OTHER", financialAmount: 0 });
    expect(await db.supplierLedgerEntry.count({ where: { supplierReturnId: other.id } })).toBe(0);
    expect(await damaged(v.id)).toBe(0);
  });

  it("frees the units of a rejected return and refuses one whose damaged stock is gone", async () => {
    const owner = await staff("OWNER");
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const buyer = await staff("MANAGER", PURCHASING);
    const {
      po,
      variant: v,
      receiptItemId,
    } = await receivedWithDamage(owner.token, warehouse.token);
    const lines = [{ goodsReceiptItemId: receiptItemId, quantity: 3 }];

    // A draft holds nothing; a pending return holds its units.
    const first = await data(await newReturn(po.id, buyer.token, lines), 201);
    const second = await data(await newReturn(po.id, buyer.token, lines), 201);
    const pending = await data(
      await post(submitReturn, "/admin/supplier-returns/x/submit", first.id, buyer.token),
    );
    expect(
      (await errorOf(await newReturn(po.id, buyer.token, lines), 400)).details.issues[0].code,
    ).toBe("quantity_exceeds_returnable");
    const held = await errorOf(
      await post(submitReturn, "/admin/supplier-returns/x/submit", second.id, buyer.token),
      409,
    );
    expect(held.details.reason).toBe("RETURN_QUANTITY_EXCEEDED");

    await data(
      await post(
        rejectRequest,
        "/admin/approval-requests/x/reject",
        pending.approval.id,
        owner.token,
        {
          reason: "Supplier will not take them back",
        },
      ),
    );
    const rejected = await data(
      await call(getReturn, `/admin/supplier-returns/${first.id}`, {
        token: buyer.token,
        params: { id: first.id },
      }),
    );
    expect(rejected).toMatchObject({
      status: "REJECTED",
      approval: { status: "REJECTED", resolutionReason: "Supplier will not take them back" },
    });
    expect(await damaged(v.id)).toBe(3);

    const resubmitted = await data(
      await post(submitReturn, "/admin/supplier-returns/x/submit", second.id, buyer.token),
    );
    // The damaged units were written off meanwhile.
    await db.inventoryMovement.create({
      data: {
        productVariantId: v.id,
        movementType: "DAMAGE_WRITE_OFF",
        damagedDelta: -3,
        reason: "Disposed",
        createdByType: "EMPLOYEE",
        createdById: owner.employee.id,
      },
    });
    const gone = await errorOf(
      await post(
        approveRequest,
        "/admin/approval-requests/x/approve",
        resubmitted.approval.id,
        owner.token,
        {},
      ),
      409,
    );
    expect(gone.details.reason).toBe("DAMAGED_STOCK_INSUFFICIENT");
    expect((await db.supplierReturn.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      "PENDING_APPROVAL",
    );

    const listed = await data(
      await call(listReturns, `/admin/supplier-returns?purchaseId=${po.id}&status=REJECTED`, {
        token: buyer.token,
      }),
    );
    expect(listed.map((r: { id: string }) => r.id)).toEqual([first.id]);
  });
});

describe("supplier payments and balance", () => {
  it("records partial and advance payments idempotently, with Q118 status per order", async () => {
    const owner = await staff("OWNER");
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const finance = await staff("EMPLOYEE", [...PAYMENTS, "SUPPLIER_FINANCE_VIEW"]);
    const { po, supplierId } = await receivedWithDamage(owner.token, warehouse.token);
    const second = await receivedWithDamage(owner.token, warehouse.token, supplierId);
    await invoiceFor(po.id, finance.token, 10_000);
    await invoiceFor(second.po.id, finance.token, 5000);

    const key = randomUUID();
    const body = {
      amount: 4000,
      method: "BANK_TRANSFER",
      paidOn: "2026-10-03",
      purchaseId: po.id,
      reference: "TRX-1",
    };
    const first = await data(await pay(supplierId, finance.token, body, key), 201);
    expect(first.payment).toMatchObject({
      amount: 4000,
      method: "BANK_TRANSFER",
      paidOn: "2026-10-03",
      purchase: { id: po.id },
      recordedBy: { id: finance.employee.id },
    });
    expect(first.balance.balance).toBe(11_000);
    const replay = await data(await pay(supplierId, finance.token, body, key), 201);
    expect(replay.payment.id).toBe(first.payment.id);
    const reused = await errorOf(
      await pay(supplierId, finance.token, { ...body, amount: 4001 }, key),
      409,
    );
    expect(reused.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await db.supplierPayment.count()).toBe(1);

    const otherSupplier = await supplier();
    const wrongOrder = await errorOf(await pay(otherSupplier.id, finance.token, body), 400);
    expect(wrongOrder.details.issues[0].code).toBe("purchase_not_found");

    // Pays the second order in full, plus an advance beyond what is owed.
    await data(
      await pay(supplierId, finance.token, { ...body, amount: 5000, purchaseId: second.po.id }),
      201,
    );
    const advance = await data(
      await pay(supplierId, finance.token, { amount: 7000, method: "CASH", paidOn: "2026-10-03" }),
      201,
    );
    expect(advance.balance).toMatchObject({
      balance: -1000,
      totals: { invoiced: 15_000, paid: 16_000 },
    });
    expect(
      advance.balance.purchases.map((p: { id: string; paymentStatus: string }) => [
        p.id,
        p.paymentStatus,
      ]),
    ).toEqual([
      [po.id, "PARTIALLY_PAID"],
      [second.po.id, "PAID"],
    ]);
    expect(
      await db.auditLog.count({
        where: { action: "SUPPLIER_PAYMENT_RECORDED", entityId: supplierId },
      }),
    ).toBe(3);
  });

  it("keeps the ledger, payments and return lines append-only in the database", async () => {
    const owner = await staff("OWNER");
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const { po, receiptItemId, supplierId } = await receivedWithDamage(
      owner.token,
      warehouse.token,
    );
    await invoiceFor(po.id, owner.token, 10_000);
    await data(
      await pay(supplierId, owner.token, { amount: 100, method: "CASH", paidOn: "2026-10-03" }),
      201,
    );
    await data(
      await newReturn(po.id, owner.token, [{ goodsReceiptItemId: receiptItemId, quantity: 1 }]),
      201,
    );

    await expect(db.$executeRaw`UPDATE supplier_ledger_entries SET amount = 1`).rejects.toThrow(
      /append-only/,
    );
    await expect(db.$executeRaw`DELETE FROM supplier_payments`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`UPDATE supplier_return_items SET quantity = 2`).rejects.toThrow(
      /append-only/,
    );
    await expect(db.$executeRaw`DELETE FROM supplier_returns`).rejects.toThrow(/append-only/);
    // A payment entry must lower the balance.
    const payment = await db.supplierPayment.findFirstOrThrow();
    await expect(
      db.supplierLedgerEntry.create({
        data: {
          supplierId,
          supplierPaymentId: randomUUID(),
          entryType: "PAYMENT",
          direction: "CREDIT",
          amount: payment.amount,
          createdByEmployeeId: owner.employee.id,
        },
      }),
    ).rejects.toThrow();
  });
});
