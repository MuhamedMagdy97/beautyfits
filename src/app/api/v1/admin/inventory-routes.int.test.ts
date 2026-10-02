import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as adjust } from "@/app/api/v1/admin/inventory/[variantId]/adjust/route";
import { GET as listMovements } from "@/app/api/v1/admin/inventory/[variantId]/movements/route";
import { GET as getInventory } from "@/app/api/v1/admin/inventory/[variantId]/route";
import { GET as lowStock } from "@/app/api/v1/admin/inventory/low-stock/route";
import { GET as listInventory } from "@/app/api/v1/admin/inventory/route";
import { POST as archiveProduct } from "@/app/api/v1/admin/products/[id]/archive/route";
import { PATCH as patchProduct } from "@/app/api/v1/admin/products/[id]/route";
import { POST as createVariant } from "@/app/api/v1/admin/products/[id]/variants/route";
import { POST as createProduct } from "@/app/api/v1/admin/products/route";
import { POST as archiveVariant } from "@/app/api/v1/admin/variants/[id]/archive/route";
import { PATCH as patchVariant } from "@/app/api/v1/admin/variants/[id]/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of inventory balances, the movement ledger, manual
 * adjustments and low-stock alerts (API §22, TASK-019, ADR-0024).
 */

const db = getDb();
const BASE = "http://localhost/api/v1";
const SAME_ORIGIN = "http://localhost";

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
      email: `inventory${counter}@beautyfits.example`,
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

/** The Warehouse Employee default role: sees stock, cannot adjust it. */
const WAREHOUSE: PermissionCode[] = ["INVENTORY_VIEW", "RECEIVE_PURCHASE"];

/** The inventory part of the Inventory Manager default role (Q71). */
const INVENTORY_MANAGER: PermissionCode[] = ["PRODUCT_VIEW", "INVENTORY_VIEW", "ADJUST_INVENTORY"];

async function data(res: Response, status = 200) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data;
}

async function page(res: Response) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body as {
    data: { variantId: string; [key: string]: unknown }[];
    meta: { pagination: unknown };
  };
}

async function errorOf(res: Response, status: number) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.error;
}

async function newProduct(token: string, sku?: string) {
  counter += 1;
  return data(
    await call(createProduct, "/admin/products", {
      method: "POST",
      token,
      body: {
        nameAr: "أحمر شفاه",
        nameEn: `Matte Lipstick ${counter}`,
        defaultVariant: { sku: sku ?? `SKU-${counter}` },
      },
    }),
    201,
  );
}

function adjustStock(
  token: string,
  variantId: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  return call(adjust, `/admin/inventory/${variantId}/adjust`, {
    method: "POST",
    token,
    body,
    headers,
    params: { variantId },
  });
}

async function inventoryOf(token: string, variantId: string) {
  return data(
    await call(getInventory, `/admin/inventory/${variantId}`, { token, params: { variantId } }),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("authorization", () => {
  it("needs INVENTORY_VIEW to read and ADJUST_INVENTORY to adjust", async () => {
    const owner = await staff("OWNER");
    const variantId = (await newProduct(owner.token)).variants[0].id;
    const warehouse = await staff("EMPLOYEE", WAREHOUSE);
    const catalogOnly = await staff("EMPLOYEE", ["PRODUCT_VIEW", "PRODUCT_EDIT"]);
    const body = { type: "MANUAL_ADJUSTMENT", quantity: 5, reason: "Opening stock" };

    expect((await call(listInventory, "/admin/inventory")).status).toBe(401);
    expect((await adjustStock("", variantId, body)).status).toBe(401);
    for (const [handler, path, params] of [
      [listInventory, "/admin/inventory", {}],
      [lowStock, "/admin/inventory/low-stock", {}],
      [getInventory, `/admin/inventory/${variantId}`, { variantId }],
      [listMovements, `/admin/inventory/${variantId}/movements`, { variantId }],
    ] as const) {
      const denied = await errorOf(
        await call(handler, path, { token: catalogOnly.token, params }),
        403,
      );
      expect(denied.details.requiredPermissions).toEqual(["INVENTORY_VIEW"]);
      await page(await call(handler, path, { token: warehouse.token, params }));
    }
    const denied = await errorOf(await adjustStock(warehouse.token, variantId, body), 403);
    expect(denied.details.requiredPermissions).toEqual(["ADJUST_INVENTORY"]);
    expect(await db.inventoryMovement.count()).toBe(0);
  });

  it("requires the Origin check for cookie-authenticated adjustments", async () => {
    const owner = await staff("OWNER");
    const variantId = (await newProduct(owner.token)).variants[0].id;
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    const body = { type: "MANUAL_ADJUSTMENT", quantity: 5, reason: "Opening stock" };
    const send = (headers: Record<string, string>) =>
      call(adjust, `/admin/inventory/${variantId}/adjust`, {
        method: "POST",
        headers,
        body,
        params: { variantId },
      });
    expect((await errorOf(await send({ cookie }), 403)).code).toBe("FORBIDDEN");
    await data(await send({ cookie, origin: SAME_ORIGIN }));
    expect((await inventoryOf(owner.token, variantId)).availableQuantity).toBe(5);
  });
});

describe("balances", () => {
  it("gives every new variant an empty balance", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const second = await data(
      await call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: owner.token,
        body: { sku: "LIP-ROSE", nameAr: "وردي", nameEn: "Rose" },
        params: { id: product.id },
      }),
      201,
    );
    for (const variantId of [product.variants[0].id, second.id]) {
      expect(await inventoryOf(owner.token, variantId)).toMatchObject({
        variantId,
        product: { id: product.id, status: "DRAFT" },
        availableQuantity: 0,
        reservedQuantity: 0,
        damagedQuantity: 0,
        lowStockThreshold: null,
        lowStock: false,
      });
    }
    expect(await db.inventoryBalance.count()).toBe(2);
  });

  it("returns 404 for unknown variants", async () => {
    const owner = await staff("OWNER");
    const unknown = "0190a0a0-0000-7000-8000-000000000000";
    expect(
      (
        await errorOf(
          await call(getInventory, `/admin/inventory/${unknown}`, {
            token: owner.token,
            params: { variantId: unknown },
          }),
          404,
        )
      ).code,
    ).toBe("NOT_FOUND");
    await errorOf(
      await adjustStock(owner.token, unknown, {
        type: "MANUAL_ADJUSTMENT",
        quantity: 1,
        reason: "x",
      }),
      404,
    );
    await errorOf(
      await call(listMovements, `/admin/inventory/not-a-uuid/movements`, {
        token: owner.token,
        params: { variantId: "not-a-uuid" },
      }),
      404,
    );
  });

  it("lists every variant's stock, searchable by SKU or product name", async () => {
    const owner = await staff("OWNER");
    await newProduct(owner.token, "AAA-1");
    await newProduct(owner.token, "BBB-1");
    const all = await page(
      await call(listInventory, "/admin/inventory?pageSize=1", { token: owner.token }),
    );
    expect(all.data.map((item) => item.sku)).toEqual(["AAA-1"]);
    expect(all.meta.pagination).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    const found = await page(
      await call(listInventory, "/admin/inventory?search=bbb", { token: owner.token }),
    );
    expect(found.data.map((item) => item.sku)).toEqual(["BBB-1"]);
  });
});

describe("manual adjustments", () => {
  it("corrects, damages and writes off stock, each with a movement and an audit entry", async () => {
    const owner = await staff("OWNER");
    const manager = await staff("MANAGER", INVENTORY_MANAGER);
    const variantId = (await newProduct(owner.token)).variants[0].id;

    const opening = await data(
      await adjustStock(
        manager.token,
        variantId,
        { type: "MANUAL_ADJUSTMENT", quantity: 10, reason: "Opening stock" },
        { "x-request-id": "req-inv-1" },
      ),
    );
    expect(opening.inventory).toMatchObject({
      availableQuantity: 10,
      reservedQuantity: 0,
      damagedQuantity: 0,
    });
    expect(opening.movement).toMatchObject({
      variantId,
      type: "MANUAL_ADJUSTMENT",
      availableDelta: 10,
      reservedDelta: 0,
      damagedDelta: 0,
      reason: "Opening stock",
      createdBy: { type: "EMPLOYEE", id: manager.employee.id },
    });
    await data(
      await adjustStock(manager.token, variantId, {
        type: "DAMAGE",
        quantity: 3,
        reason: "Broken in shelf fall",
      }),
    );
    await data(
      await adjustStock(manager.token, variantId, {
        type: "DAMAGE_WRITE_OFF",
        quantity: 2,
        reason: "Disposed",
      }),
    );
    const count = await data(
      await adjustStock(manager.token, variantId, {
        type: "MANUAL_ADJUSTMENT",
        quantity: -1,
        reason: "Stock count",
      }),
    );
    expect(count.inventory).toMatchObject({ availableQuantity: 6, damagedQuantity: 1 });

    const ledger = await page(
      await call(listMovements, `/admin/inventory/${variantId}/movements`, {
        token: manager.token,
        params: { variantId },
      }),
    );
    expect(ledger.data.map((m) => m.type)).toEqual([
      "MANUAL_ADJUSTMENT",
      "DAMAGE_WRITE_OFF",
      "DAMAGE",
      "MANUAL_ADJUSTMENT",
    ]);
    // The balance is exactly the sum of the ledger (Q108).
    const sums = await db.inventoryMovement.aggregate({
      where: { productVariantId: variantId },
      _sum: { availableDelta: true, reservedDelta: true, damagedDelta: true },
    });
    expect(sums._sum).toEqual({ availableDelta: 6, reservedDelta: 0, damagedDelta: 1 });

    const audits = await db.auditLog.findMany({
      where: { action: "INVENTORY_ADJUSTED", entityId: variantId },
      orderBy: { createdAt: "asc" },
    });
    expect(audits).toHaveLength(4);
    expect(audits[0]).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: manager.employee.id,
      entityType: "PRODUCT_VARIANT",
      reason: "Opening stock",
      correlationId: "req-inv-1",
      previousDataJson: { available: 0, reserved: 0, damaged: 0 },
      newDataJson: {
        available: 10,
        reserved: 0,
        damaged: 0,
        movementId: opening.movement.id,
        movementType: "MANUAL_ADJUSTMENT",
        quantity: 10,
      },
    });
  });

  it("never takes a quantity below zero", async () => {
    const owner = await staff("OWNER");
    const variantId = (await newProduct(owner.token)).variants[0].id;
    await data(
      await adjustStock(owner.token, variantId, {
        type: "MANUAL_ADJUSTMENT",
        quantity: 2,
        reason: "Opening stock",
      }),
    );
    for (const [body, short, onHand] of [
      [{ type: "MANUAL_ADJUSTMENT", quantity: -3, reason: "Count" }, "available", 2],
      [{ type: "DAMAGE", quantity: 3, reason: "Broken" }, "available", 2],
      [{ type: "DAMAGE_WRITE_OFF", quantity: 1, reason: "Disposed" }, "damaged", 0],
    ] as const) {
      const refused = await errorOf(await adjustStock(owner.token, variantId, body), 409);
      expect(refused.details).toEqual({ reason: "INSUFFICIENT_STOCK", quantity: short, onHand });
    }
    expect(await db.inventoryMovement.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: "INVENTORY_ADJUSTED" } })).toBe(1);
  });

  it("validates the body", async () => {
    const owner = await staff("OWNER");
    const variantId = (await newProduct(owner.token)).variants[0].id;
    for (const body of [
      { type: "MANUAL_ADJUSTMENT", quantity: 1 },
      { type: "MANUAL_ADJUSTMENT", quantity: 0, reason: "x" },
      { type: "DAMAGE", quantity: -1, reason: "x" },
      { type: "PURCHASE_RECEIPT", quantity: 1, reason: "x" },
    ]) {
      expect((await errorOf(await adjustStock(owner.token, variantId, body), 400)).code).toBe(
        "VALIDATION_ERROR",
      );
    }
  });

  it("serializes concurrent adjustments without overselling", async () => {
    const owner = await staff("OWNER");
    const variantId = (await newProduct(owner.token)).variants[0].id;
    await data(
      await adjustStock(owner.token, variantId, {
        type: "MANUAL_ADJUSTMENT",
        quantity: 5,
        reason: "Opening stock",
      }),
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        adjustStock(owner.token, variantId, {
          type: "MANUAL_ADJUSTMENT",
          quantity: -1,
          reason: "Count",
        }),
      ),
    );
    const statuses = results.map((res) => res.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    expect((await inventoryOf(owner.token, variantId)).availableQuantity).toBe(0);
  });

  it("still adjusts archived variants and products (physical stock)", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const variantId = product.variants[0].id;
    await data(
      await adjustStock(owner.token, variantId, {
        type: "MANUAL_ADJUSTMENT",
        quantity: 2,
        reason: "Opening stock",
      }),
    );
    await data(
      await call(archiveProduct, `/admin/products/${product.id}/archive`, {
        method: "POST",
        token: owner.token,
        body: {},
        params: { id: product.id },
      }),
    );
    const done = await data(
      await adjustStock(owner.token, variantId, {
        type: "DAMAGE",
        quantity: 2,
        reason: "Expired",
      }),
    );
    expect(done.inventory).toMatchObject({ availableQuantity: 0, damagedQuantity: 2 });
  });
});

describe("ledger integrity", () => {
  it("keeps movements append-only and balances changeable only through movements", async () => {
    const owner = await staff("OWNER");
    const variantId = (await newProduct(owner.token)).variants[0].id;
    const { movement } = await data(
      await adjustStock(owner.token, variantId, {
        type: "MANUAL_ADJUSTMENT",
        quantity: 4,
        reason: "Opening stock",
      }),
    );
    await expect(
      db.inventoryMovement.update({ where: { id: movement.id }, data: { reason: "edited" } }),
    ).rejects.toThrow();
    await expect(db.inventoryMovement.delete({ where: { id: movement.id } })).rejects.toThrow();
    await expect(
      db.inventoryBalance.update({
        where: { productVariantId: variantId },
        data: { availableQuantity: 100 },
      }),
    ).rejects.toThrow();
    await expect(
      db.inventoryBalance.delete({ where: { productVariantId: variantId } }),
    ).rejects.toThrow();
    // A movement that would go below zero is refused by the database itself.
    await expect(
      db.inventoryMovement.create({
        data: {
          productVariantId: variantId,
          movementType: "MANUAL_ADJUSTMENT",
          availableDelta: -5,
          createdByType: "SYSTEM",
        },
      }),
    ).rejects.toThrow();
    // A movement must change something.
    await expect(
      db.inventoryMovement.create({
        data: {
          productVariantId: variantId,
          movementType: "MANUAL_ADJUSTMENT",
          createdByType: "SYSTEM",
        },
      }),
    ).rejects.toThrow();
    expect((await inventoryOf(owner.token, variantId)).availableQuantity).toBe(4);
  });
});

describe("low stock", () => {
  it("alerts at or below the variant threshold, else the product's", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token, "LIP-A");
    const first = product.variants[0].id;
    const second = await data(
      await call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: owner.token,
        body: { sku: "LIP-B" },
        params: { id: product.id },
      }),
      201,
    );
    const noThreshold = await newProduct(owner.token, "MAS-A");
    const setStock = (variantId: string, quantity: number) =>
      adjustStock(owner.token, variantId, {
        type: "MANUAL_ADJUSTMENT",
        quantity,
        reason: "Opening stock",
      });
    await data(await setStock(first, 5));
    await data(await setStock(second.id, 2));

    const updated = await data(
      await call(patchProduct, `/admin/products/${product.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { lowStockThreshold: 5 },
        params: { id: product.id },
      }),
    );
    expect(updated.lowStockThreshold).toBe(5);
    const alerts = async () =>
      (await page(await call(lowStock, "/admin/inventory/low-stock", { token: owner.token }))).data;
    // Lowest stock first; the product without a threshold never alerts.
    expect((await alerts()).map((item) => item.sku)).toEqual(["LIP-B", "LIP-A"]);
    expect(noThreshold.lowStockThreshold).toBeNull();

    // The variant override wins: 1 < 2 on hand.
    const variant = await data(
      await call(patchVariant, `/admin/variants/${second.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { lowStockThreshold: 1 },
        params: { id: second.id },
      }),
    );
    expect(variant.lowStockThreshold).toBe(1);
    expect((await alerts()).map((item) => item.sku)).toEqual(["LIP-A"]);
    expect(await inventoryOf(owner.token, second.id)).toMatchObject({
      lowStockThreshold: 1,
      lowStock: false,
    });

    // Archived variants and products no longer alert.
    await data(
      await call(patchVariant, `/admin/variants/${second.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { lowStockThreshold: 10 },
        params: { id: second.id },
      }),
    );
    expect((await alerts()).map((item) => item.sku)).toEqual(["LIP-B", "LIP-A"]);
    await data(
      await call(archiveVariant, `/admin/variants/${second.id}/archive`, {
        method: "POST",
        token: owner.token,
        body: {},
        params: { id: second.id },
      }),
    );
    expect((await alerts()).map((item) => item.sku)).toEqual(["LIP-A"]);
    await data(
      await call(archiveProduct, `/admin/products/${product.id}/archive`, {
        method: "POST",
        token: owner.token,
        body: {},
        params: { id: product.id },
      }),
    );
    expect(await alerts()).toEqual([]);

    const audits = await db.auditLog.findMany({
      where: { action: { in: ["PRODUCT_UPDATED", "PRODUCT_VARIANT_UPDATED"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(
      audits.map((a) => (a.newDataJson as { lowStockThreshold: number }).lowStockThreshold),
    ).toEqual([5, 1, 10]);
  });

  it("refuses negative thresholds and clears with null", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const patch = (body: unknown) =>
      call(patchProduct, `/admin/products/${product.id}`, {
        method: "PATCH",
        token: owner.token,
        body,
        params: { id: product.id },
      });
    await errorOf(await patch({ lowStockThreshold: -1 }), 400);
    await errorOf(await patch({ lowStockThreshold: 1.5 }), 400);
    expect((await data(await patch({ lowStockThreshold: 3 }))).lowStockThreshold).toBe(3);
    expect((await data(await patch({ lowStockThreshold: null }))).lowStockThreshold).toBeNull();
  });
});
