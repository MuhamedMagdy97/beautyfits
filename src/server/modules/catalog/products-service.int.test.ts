import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { createLogger } from "@/server/logging/logger";
import { createProductMediaService } from "@/server/modules/catalog/media-service";
import {
  createProductsService,
  MAX_VARIANTS_PER_PRODUCT,
} from "@/server/modules/catalog/products-service";
import { systemClock } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Products and variants against PostgreSQL (TASK-014, C6, Q75, ADR-0019). */

const db = getDb();
const service = createProductsService({ db, clock: systemClock });
const mediaService = createProductMediaService({ db, clock: systemClock });
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

/** A checked (`SAFE`) image file, attached as the product's main image. */
async function withMainImage(actorId: string, productId: string): Promise<string> {
  const now = new Date();
  const asset = await db.mediaAsset.create({
    data: {
      storageProvider: "LOCAL",
      objectKey: `test/${Math.random().toString(36).slice(2)}.png`,
      originalFilename: "a.png",
      mimeType: "image/png",
      sizeBytes: 100,
      width: 600,
      height: 600,
      checksum: "0".repeat(64),
      scanStatus: "SAFE",
      purpose: "PRODUCT_MEDIA",
      uploadExpiresAt: now,
      completedAt: now,
      createdByEmployeeId: actorId,
    },
  });
  const media = await mediaService.addMedia(
    { employeeId: actorId },
    productId,
    { mediaAssetId: asset.id },
    logger,
  );
  return media.id;
}

describe("product lifecycle in the database (TASK-017)", () => {
  it("never lets an archived product change status again", async () => {
    const actor = await employeeId();
    const product = await newProduct(actor);
    await service.changeProductStatus({ employeeId: actor }, product.id, "archive", {}, logger);
    await expect(
      db.product.update({
        where: { id: product.id },
        data: { status: "DRAFT", archivedAt: null },
      }),
    ).rejects.toThrow();
    // Other columns may still be written (e.g. by later maintenance); only the status is final.
    await db.product.update({ where: { id: product.id }, data: { updatedAt: new Date() } });
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
      "ARCHIVED",
    );
  });

  it("keeps archived_at and first_published_at consistent with the status", async () => {
    const product = await newProduct(await employeeId());
    await expect(
      db.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } }),
    ).rejects.toThrow();
    await expect(
      db.product.update({ where: { id: product.id }, data: { archivedAt: new Date() } }),
    ).rejects.toThrow();
    await expect(
      db.product.update({ where: { id: product.id }, data: { status: "PUBLISHED" } }),
    ).rejects.toThrow();
  });

  it("serializes a publish and the removal of the last image: never published without one", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetDatabase();
      const actor = await employeeId();
      const product = await newProduct(actor);
      const mediaId = await withMainImage(actor, product.id);
      const [published, removed] = await Promise.allSettled([
        service.changeProductStatus({ employeeId: actor }, product.id, "publish", {}, logger),
        mediaService.removeMedia({ employeeId: actor }, product.id, mediaId, logger),
      ]);
      // Exactly one wins: either the image is gone and the publish was
      // refused, or the product is published and keeps its image.
      expect([published.status, removed.status].sort()).toEqual(["fulfilled", "rejected"]);
      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      const images = await db.productMedia.count({
        where: { productId: product.id, removedAt: null },
      });
      expect({ status: row.status, images }).toEqual(
        published.status === "fulfilled"
          ? { status: "PUBLISHED", images: 1 }
          : { status: "DRAFT", images: 0 },
      );
    }
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
