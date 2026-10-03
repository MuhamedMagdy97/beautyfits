import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approveRequest } from "@/app/api/v1/admin/approval-requests/[id]/approve/route";
import { POST as rejectRequest } from "@/app/api/v1/admin/approval-requests/[id]/reject/route";
import { POST as cancelPurchase } from "@/app/api/v1/admin/purchases/[id]/cancel/route";
import { POST as closePurchase } from "@/app/api/v1/admin/purchases/[id]/close/route";
import { POST as recordInvoice } from "@/app/api/v1/admin/purchases/[id]/invoice/route";
import { POST as receivePurchase } from "@/app/api/v1/admin/purchases/[id]/receive/route";
import { GET as getPurchase } from "@/app/api/v1/admin/purchases/[id]/route";
import { POST as submitPurchase } from "@/app/api/v1/admin/purchases/[id]/submit/route";
import { GET as listPurchases, POST as createPurchase } from "@/app/api/v1/admin/purchases/route";
import { POST as uploadInit } from "@/app/api/v1/files/upload-init/route";
import type { EmployeeLevel, MediaPurpose } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of goods receiving, supplier invoices and closing (TASK-023, ADR-0028). */

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
      email: `receiving${counter}@beautyfits.example`,
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
const PURCHASING: PermissionCode[] = ["SUPPLIER_VIEW", "PURCHASE_VIEW", "PURCHASE_CREATE"];
const WAREHOUSE: PermissionCode[] = ["INVENTORY_VIEW", "RECEIVE_PURCHASE"];

async function variant(sellingPrice: bigint | null = null) {
  counter += 1;
  const product = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      variants: { create: { sku: `SKU-${counter}`, isDefault: true, sellingPrice } },
    },
    include: { variants: true },
  });
  return product.variants[0];
}

/** An approved purchase order (an Owner's submit approves it at once). */
async function approvedOrder(
  ownerToken: string,
  items: { variantId: string; quantity: number; unitCost: number }[],
) {
  counter += 1;
  const acme = await db.supplier.create({ data: { name: `Supplier ${counter}` } });
  const po = await data(
    await call(createPurchase, "/admin/purchases", {
      method: "POST",
      token: ownerToken,
      body: { supplierId: acme.id, items },
    }),
    201,
  );
  return data(await act(submitPurchase, po.id, ownerToken));
}

function act(handler: unknown, id: string, token: string, body?: unknown) {
  return call(handler, `/admin/purchases/${id}`, { method: "POST", token, body, params: { id } });
}

function receive(id: string, token: string, body: unknown, key: string | null = randomUUID()) {
  return call(receivePurchase, `/admin/purchases/${id}/receive`, {
    method: "POST",
    token,
    body,
    params: { id },
    headers: key === null ? {} : { "idempotency-key": key },
  });
}

function get(id: string, token: string) {
  return call(getPurchase, `/admin/purchases/${id}`, { token, params: { id } });
}

async function balance(variantId: string) {
  return db.inventoryBalance.findUniqueOrThrow({ where: { productVariantId: variantId } });
}

async function safeFile(purpose: MediaPurpose = "SUPPLIER_INVOICE") {
  counter += 1;
  return db.mediaAsset.create({
    data: {
      storageProvider: "LOCAL",
      objectKey: `test/${counter}.png`,
      originalFilename: "invoice.png",
      mimeType: "image/png",
      sizeBytes: 100,
      width: 800,
      height: 1000,
      checksum: "0".repeat(64),
      purpose,
      scanStatus: "SAFE",
      uploadExpiresAt: new Date(),
      completedAt: new Date(),
    },
  });
}

function invoice(id: string, token: string, body: Record<string, unknown>) {
  return call(recordInvoice, `/admin/purchases/${id}/invoice`, {
    method: "POST",
    token,
    body: { invoiceNumber: "INV-1", invoiceDate: "2026-10-01", invoiceTotal: 97_000, ...body },
    params: { id },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("goods receiving", () => {
  it("guards each endpoint with its permission; receiving staff see orders without amounts", async () => {
    const owner = await staff("OWNER");
    const buyer = await staff("MANAGER", PURCHASING);
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const nobody = await staff("EMPLOYEE", ["INVENTORY_VIEW"]);
    const v = await variant();
    const po = await approvedOrder(owner.token, [{ variantId: v.id, quantity: 2, unitCost: 500 }]);
    const line = { purchaseItemId: po.items[0].id, deliveredQuantity: 2 };

    expect((await receive(po.id, "", { items: [line] })).status).toBe(401);
    expect((await receive(po.id, buyer.token, { items: [line] })).status).toBe(403);
    expect((await get(po.id, nobody.token)).status).toBe(403);

    const seen = await data(await get(po.id, warehouse.token));
    expect(seen.orderedTotal).toBeUndefined();
    expect(seen.items[0].unitCost).toBeUndefined();
    expect(seen.invoices).toBeUndefined();
    const listed = await data(
      await call(listPurchases, "/admin/purchases", { token: warehouse.token }),
    );
    expect(listed[0].orderedTotal).toBeUndefined();
    expect((await data(await get(po.id, buyer.token))).items[0].unitCost).toBe(500);

    const noKey = await errorOf(
      await receive(po.id, warehouse.token, { items: [line] }, null),
      400,
    );
    expect(noKey.details.issues[0].code).toBe("idempotency_key_required");

    const file = await safeFile();
    expect((await invoice(po.id, buyer.token, { mediaAssetId: file.id })).status).toBe(403);
    expect((await act(closePurchase, po.id, warehouse.token, { reason: "x" })).status).toBe(403);
    const upload = await call(uploadInit, "/files/upload-init", {
      method: "POST",
      token: buyer.token,
      body: {
        purpose: "SUPPLIER_INVOICE",
        filename: "inv.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
    });
    expect(upload.status).toBe(403);
  });

  it("receives a short delivery, records the invoice unchanged and closes the order (Q115, Q117)", async () => {
    const owner = await staff("OWNER");
    const buyer = await staff("MANAGER", PURCHASING);
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const v = await variant();
    const po = await approvedOrder(owner.token, [
      { variantId: v.id, quantity: 100, unitCost: 1000 },
    ]);
    const itemId = po.items[0].id;

    const missingNote = await errorOf(
      await receive(po.id, warehouse.token, {
        items: [{ purchaseItemId: itemId, deliveredQuantity: 97 }],
      }),
      400,
    );
    expect(missingNote.details.issues[0]).toMatchObject({
      path: "items.0.notes",
      code: "notes_required",
    });

    const result = await data(
      await receive(po.id, warehouse.token, {
        items: [{ purchaseItemId: itemId, deliveredQuantity: 97, notes: "3 units short" }],
      }),
      201,
    );
    expect(result.receipt).toMatchObject({ receiptNumber: "GR-000001" });
    expect(result.receipt.items[0]).toMatchObject({
      acceptedQuantity: 97,
      overDeliveryQuantity: 0,
    });
    expect(result.costReview).toBeUndefined();
    expect(result.purchase.status).toBe("PARTIALLY_RECEIVED");
    expect(result.purchase.items[0]).toMatchObject({ receivedQuantity: 97, remainingQuantity: 3 });

    expect(await balance(v.id)).toMatchObject({ availableQuantity: 97, damagedQuantity: 0 });
    const movement = await db.inventoryMovement.findFirstOrThrow({
      where: { productVariantId: v.id },
    });
    expect(movement).toMatchObject({
      movementType: "PURCHASE_RECEIPT",
      availableDelta: 97,
      unitCost: BigInt(1000),
      referenceType: "GOODS_RECEIPT",
      referenceId: result.receipt.id,
    });
    const costed = await db.productVariant.findUniqueOrThrow({ where: { id: v.id } });
    expect(costed.latestPurchaseCost).toBe(BigInt(1000));
    expect(costed.weightedAverageCost).toBe(BigInt(1000));
    expect(costed.firstGoodsReceiptAt).not.toBeNull();

    const closeEarly = await errorOf(
      await act(closePurchase, po.id, buyer.token, { reason: "Rest not coming" }),
      409,
    );
    expect(closeEarly.details.reason).toBe("INVOICE_REQUIRED");

    // The invoice says 100; it is recorded as issued (Q115).
    const file = await safeFile();
    const withInvoice = await data(
      await invoice(po.id, owner.token, {
        invoiceTotal: 100_000,
        taxAmount: 12_281,
        mediaAssetId: file.id,
      }),
      201,
    );
    expect(withInvoice.invoices[0]).toMatchObject({
      invoiceNumber: "INV-1",
      invoiceDate: "2026-10-01",
      invoiceTotal: 100_000,
      taxAmount: 12_281,
      file: { mediaAssetId: file.id, url: `/api/v1/files/${file.id}/content` },
    });
    expect((await data(await get(po.id, buyer.token))).invoices).toBeUndefined();

    const closed = await data(
      await act(closePurchase, po.id, buyer.token, { reason: "Rest not coming" }),
    );
    expect(closed).toMatchObject({ status: "CLOSED", closingReason: "Rest not coming" });
    const late = await errorOf(
      await receive(po.id, warehouse.token, {
        items: [{ purchaseItemId: itemId, deliveredQuantity: 3 }],
      }),
      409,
    );
    expect(late.details.reason).toBe("PURCHASE_STATUS_INVALID");

    const actions = await db.auditLog.findMany({
      where: { entityId: po.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true },
    });
    expect(actions.map((a) => a.action).slice(-3)).toEqual([
      "GOODS_RECEIPT_RECORDED",
      "PURCHASE_INVOICE_RECORDED",
      "PURCHASE_ORDER_CLOSED",
    ]);
  });

  it("puts damaged units in Damaged, updates the weighted average and warns on margin (Q102-Q104)", async () => {
    const owner = await staff("OWNER");
    const v = await variant(BigInt(1400));
    const first = await approvedOrder(owner.token, [
      { variantId: v.id, quantity: 10, unitCost: 1000 },
    ]);
    const r1 = await data(
      await receive(first.id, owner.token, {
        items: [
          {
            purchaseItemId: first.items[0].id,
            deliveredQuantity: 10,
            damagedQuantity: 2,
            notes: "2 crushed",
          },
        ],
      }),
      201,
    );
    expect(r1.purchase.status).toBe("RECEIVED");
    expect(await balance(v.id)).toMatchObject({ availableQuantity: 8, damagedQuantity: 2 });

    const second = await approvedOrder(owner.token, [
      { variantId: v.id, quantity: 4, unitCost: 1300 },
    ]);
    const r2 = await data(
      await receive(second.id, owner.token, {
        items: [{ purchaseItemId: second.items[0].id, deliveredQuantity: 4 }],
      }),
      201,
    );
    // (8 × 1000 + 4 × 1300) / 12 = 1100; damaged units do not count.
    expect(r2.costReview).toEqual([
      {
        variantId: v.id,
        previousLatestPurchaseCost: 1000,
        latestPurchaseCost: 1300,
        weightedAverageCost: 1100,
        sellingPrice: 1400,
        marginBasisPoints: 714,
        marginReduced: true,
        warnings: ["BELOW_MINIMUM_MARGIN"],
      },
    ]);
  });

  it("holds over-delivered extras until an Owner/Admin approves them (Q116)", async () => {
    const owner = await staff("OWNER");
    const buyer = await staff("MANAGER", PURCHASING);
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const v = await variant();
    const po = await approvedOrder(owner.token, [
      { variantId: v.id, quantity: 100, unitCost: 1000 },
    ]);

    const result = await data(
      await receive(po.id, warehouse.token, {
        items: [{ purchaseItemId: po.items[0].id, deliveredQuantity: 105, notes: "5 extra" }],
      }),
      201,
    );
    expect(result.purchase.status).toBe("RECEIVED");
    expect(result.receipt.items[0]).toMatchObject({
      acceptedQuantity: 100,
      overDeliveryQuantity: 5,
    });
    expect(result.receipt.overDelivery.status).toBe("PENDING");
    expect((await balance(v.id)).availableQuantity).toBe(100);

    await data(await invoice(po.id, owner.token, { mediaAssetId: (await safeFile()).id }), 201);
    const blocked = await errorOf(
      await act(closePurchase, po.id, buyer.token, { reason: "Done" }),
      409,
    );
    expect(blocked.details.reason).toBe("OVER_DELIVERY_PENDING");

    const requestId = result.receipt.overDelivery.approvalRequestId;
    await data(
      await call(approveRequest, `/admin/approval-requests/${requestId}/approve`, {
        method: "POST",
        token: owner.token,
        body: { reason: "Keep them" },
        params: { id: requestId },
      }),
    );
    expect((await balance(v.id)).availableQuantity).toBe(105);
    const after = await data(await get(po.id, owner.token));
    expect(after.items[0]).toMatchObject({ receivedQuantity: 100, extraAcceptedQuantity: 5 });
    expect(after.receipts[0].overDelivery.status).toBe("APPROVED");
    expect(
      await db.auditLog.count({
        where: { entityId: po.id, action: "PURCHASE_OVER_DELIVERY_ACCEPTED" },
      }),
    ).toBe(1);
    expect(
      (await data(await act(closePurchase, po.id, buyer.token, { reason: "Done" }))).status,
    ).toBe("CLOSED");
  });

  it("returns rejected extras without stock, and accepts an Owner's own extras at once", async () => {
    const owner = await staff("OWNER");
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const v = await variant();
    const po = await approvedOrder(owner.token, [
      { variantId: v.id, quantity: 10, unitCost: 1000 },
    ]);
    const result = await data(
      await receive(po.id, warehouse.token, {
        items: [{ purchaseItemId: po.items[0].id, deliveredQuantity: 12, notes: "2 extra" }],
      }),
      201,
    );
    const requestId = result.receipt.overDelivery.approvalRequestId;
    await data(
      await call(rejectRequest, `/admin/approval-requests/${requestId}/reject`, {
        method: "POST",
        token: owner.token,
        body: { reason: "Send them back" },
        params: { id: requestId },
      }),
    );
    expect((await balance(v.id)).availableQuantity).toBe(10);
    expect(
      await db.auditLog.count({
        where: { entityId: po.id, action: "PURCHASE_OVER_DELIVERY_REJECTED" },
      }),
    ).toBe(1);

    const w = await variant();
    const own = await approvedOrder(owner.token, [
      { variantId: w.id, quantity: 10, unitCost: 1000 },
    ]);
    const mine = await data(
      await receive(own.id, owner.token, {
        items: [{ purchaseItemId: own.items[0].id, deliveredQuantity: 12, notes: "2 extra" }],
      }),
      201,
    );
    expect(mine.receipt.overDelivery).toBeNull();
    expect(mine.purchase.items[0].extraAcceptedQuantity).toBe(2);
    expect((await balance(w.id)).availableQuantity).toBe(12);
  });

  it("replays a retried receive once and refuses a reused key with another body", async () => {
    const owner = await staff("OWNER");
    const v = await variant();
    const po = await approvedOrder(owner.token, [
      { variantId: v.id, quantity: 10, unitCost: 1000 },
    ]);
    const body = {
      items: [{ purchaseItemId: po.items[0].id, deliveredQuantity: 4, notes: "first part" }],
    };
    const key = randomUUID();
    const first = await data(await receive(po.id, owner.token, body, key), 201);
    const again = await data(await receive(po.id, owner.token, body, key), 201);
    expect(again.receipt.id).toBe(first.receipt.id);
    expect((await balance(v.id)).availableQuantity).toBe(4);
    const reused = await errorOf(
      await receive(po.id, owner.token, { ...body, notes: "changed" }, key),
      409,
    );
    expect(reused.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("refuses invalid receipts and orders that cannot be received or cancelled", async () => {
    const owner = await staff("OWNER");
    const v = await variant();
    const po = await approvedOrder(owner.token, [
      { variantId: v.id, quantity: 10, unitCost: 1000 },
    ]);
    const itemId = po.items[0].id;
    const issue = async (items: unknown[]) =>
      (await errorOf(await receive(po.id, owner.token, { items }), 400)).details.issues[0];

    expect(await issue([{ purchaseItemId: randomUUID(), deliveredQuantity: 1 }])).toMatchObject({
      code: "purchase_item_not_found",
    });
    expect(
      await issue([
        { purchaseItemId: itemId, deliveredQuantity: 2, damagedQuantity: 3, notes: "x" },
      ]),
    ).toMatchObject({ code: "damaged_exceeds_delivered" });
    expect(
      await issue([
        { purchaseItemId: itemId, deliveredQuantity: 12, damagedQuantity: 11, notes: "x" },
      ]),
    ).toMatchObject({ code: "damaged_exceeds_due" });

    const draft = await data(
      await call(createPurchase, "/admin/purchases", {
        method: "POST",
        token: owner.token,
        body: {
          supplierId: po.supplier.id,
          items: [{ variantId: v.id, quantity: 1, unitCost: 1 }],
        },
      }),
      201,
    );
    const notApproved = await errorOf(
      await receive(draft.id, owner.token, {
        items: [{ purchaseItemId: draft.items[0].id, deliveredQuantity: 1 }],
      }),
      409,
    );
    expect(notApproved.details.reason).toBe("PURCHASE_STATUS_INVALID");

    await data(
      await receive(po.id, owner.token, {
        items: [{ purchaseItemId: itemId, deliveredQuantity: 5, notes: "first half" }],
      }),
      201,
    );
    const cancel = await errorOf(
      await act(cancelPurchase, po.id, owner.token, { reason: "x" }),
      409,
    );
    expect(cancel.details.reason).toBe("PURCHASE_STATUS_INVALID");
  });

  it("validates invoices: number once per order, invoice files only, tax within the total", async () => {
    const owner = await staff("OWNER");
    const v = await variant();
    const po = await approvedOrder(owner.token, [{ variantId: v.id, quantity: 1, unitCost: 1000 }]);
    await data(await invoice(po.id, owner.token, { mediaAssetId: (await safeFile()).id }), 201);

    const duplicate = await errorOf(
      await invoice(po.id, owner.token, { mediaAssetId: (await safeFile()).id }),
      409,
    );
    expect(duplicate.details.reason).toBe("INVOICE_NUMBER_TAKEN");
    const productImage = await errorOf(
      await invoice(po.id, owner.token, {
        invoiceNumber: "INV-2",
        mediaAssetId: (await safeFile("PRODUCT_MEDIA")).id,
      }),
      400,
    );
    expect(productImage.details.issues[0].code).toBe("media_asset_not_found");
    const tax = await errorOf(
      await invoice(po.id, owner.token, {
        invoiceNumber: "INV-3",
        taxAmount: 98_000,
        mediaAssetId: (await safeFile()).id,
      }),
      400,
    );
    expect(tax.details.issues[0].path).toBe("taxAmount");
  });

  it("keeps receipts and invoices append-only in the database", async () => {
    const owner = await staff("OWNER");
    const v = await variant();
    const po = await approvedOrder(owner.token, [{ variantId: v.id, quantity: 1, unitCost: 1000 }]);
    await data(
      await receive(po.id, owner.token, {
        items: [{ purchaseItemId: po.items[0].id, deliveredQuantity: 1 }],
      }),
      201,
    );
    await data(await invoice(po.id, owner.token, { mediaAssetId: (await safeFile()).id }), 201);

    await expect(db.$executeRaw`UPDATE goods_receipts SET notes = 'x'`).rejects.toThrow(
      /append-only/,
    );
    await expect(db.$executeRaw`DELETE FROM goods_receipt_items`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`UPDATE purchase_invoices SET invoice_total = 1`).rejects.toThrow(
      /append-only/,
    );
  });
});
