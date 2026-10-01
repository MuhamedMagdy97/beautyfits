import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { createLogger } from "@/server/logging/logger";
import {
  createProductsService,
  MAX_VARIANTS_PER_PRODUCT,
} from "@/server/modules/catalog/products-service";
import { systemClock } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Products and variants against PostgreSQL (TASK-014, C6, Q75, ADR-0019). */

const db = getDb();
const service = createProductsService({ db, clock: systemClock });
const logger = createLogger({ level: "error" });

async function employeeId(): Promise<string> {
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `catalog-svc-${Math.random().toString(36).slice(2)}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: { create: { displayName: "Catalog", employeeLevel: "OWNER" } },
    },
    include: { employee: true },
  });
  return account.employee!.id;
}

async function newProduct(actorId: string, sku = "BASE-1", slug = "base") {
  return service.createProduct(
    { employeeId: actorId },
    { nameAr: "منتج", nameEn: "Base", slug, defaultVariant: { sku } },
    logger,
  );
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("history is kept", () => {
  it("rejects hard deletes of products and variants", async () => {
    const product = await newProduct(await employeeId());
    await expect(
      db.productVariant.delete({ where: { id: product.variants[0].id } }),
    ).rejects.toThrow();
    await expect(db.product.delete({ where: { id: product.id } })).rejects.toThrow();
    expect(await db.product.count()).toBe(1);
    expect(await db.productVariant.count()).toBe(1);
  });

  it("allows at most one default variant per product, and only an active one", async () => {
    const product = await newProduct(await employeeId());
    await expect(
      db.productVariant.create({
        data: { productId: product.id, sku: "SECOND-DEFAULT", isDefault: true },
      }),
    ).rejects.toThrow();
    await expect(
      db.productVariant.update({
        where: { id: product.variants[0].id },
        data: { status: "ARCHIVED" },
      }),
    ).rejects.toThrow();
  });

  it("enforces uppercase SKUs and lowercase slugs in the database", async () => {
    const product = await newProduct(await employeeId());
    await expect(
      db.productVariant.create({ data: { productId: product.id, sku: "lower" } }),
    ).rejects.toThrow();
    await expect(
      db.product.create({ data: { nameAr: "a", nameEn: "b", slug: "Upper Case" } }),
    ).rejects.toThrow();
  });
});

describe("concurrency", () => {
  it("one of two simultaneous default moves wins; exactly one default remains", async () => {
    const actor = await employeeId();
    const product = await newProduct(actor);
    const a = await service.createVariant({ employeeId: actor }, product.id, { sku: "A" }, logger);
    const b = await service.createVariant({ employeeId: actor }, product.id, { sku: "B" }, logger);

    await Promise.all([
      service.updateVariant({ employeeId: actor }, a.id, { isDefault: true }, logger),
      service.updateVariant({ employeeId: actor }, b.id, { isDefault: true }, logger),
    ]);
    const defaults = await db.productVariant.count({
      where: { productId: product.id, isDefault: true },
    });
    expect(defaults).toBe(1);
  });

  it("gives one of two simultaneous creations with the same SKU a conflict", async () => {
    const actor = await employeeId();
    const first = await newProduct(actor, "P1", "p1");
    const second = await newProduct(actor, "P2", "p2");
    const results = await Promise.allSettled([
      service.createVariant({ employeeId: actor }, first.id, { sku: "SAME" }, logger),
      service.createVariant({ employeeId: actor }, second.id, { sku: "SAME" }, logger),
    ]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "CONFLICT",
      details: { reason: "SKU_TAKEN" },
    });
    expect(await db.auditLog.count({ where: { action: "PRODUCT_VARIANT_CREATED" } })).toBe(1);
  });
});

describe("limits", () => {
  it(`refuses more than ${MAX_VARIANTS_PER_PRODUCT} variants per product`, async () => {
    const actor = await employeeId();
    const product = await newProduct(actor);
    await db.productVariant.createMany({
      data: Array.from({ length: MAX_VARIANTS_PER_PRODUCT - 1 }, (_, i) => ({
        productId: product.id,
        sku: `BULK-${i}`,
      })),
    });
    await expect(
      service.createVariant({ employeeId: actor }, product.id, { sku: "ONE-MORE" }, logger),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "VARIANT_LIMIT" } });
  });
});
