import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { createLogger } from "@/server/logging/logger";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { runBootstrap } from "@/server/modules/bootstrap/bootstrap";
import { runDevCatalogSeed, SAMPLE_PRODUCTS } from "@/server/modules/bootstrap/dev-catalog";
import { createLocalFileStorage } from "@/server/storage/storage";
import { resetDatabase } from "@/test/integration/database";

/** Development sample catalog (TASK-059A) against the test database. */

const db = getDb();
const clock = { now: () => new Date() };
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 });
const logger = createLogger({ level: "error", write: () => {} });
let mediaDir: string;

beforeAll(async () => {
  await resetDatabase();
  mediaDir = await mkdtemp(path.join(tmpdir(), "dev-catalog-"));
  await runBootstrap(
    { db, clock, hasher, logger },
    { owner: { email: "owner@beautyfits.example", password: "saffron harbour under quiet lamps" } },
  );
});

afterAll(async () => {
  await resetDatabase();
  await rm(mediaDir, { recursive: true, force: true });
});

describe("runDevCatalogSeed", () => {
  it("publishes the sample products with prices, images and ledger stock, once", async () => {
    const deps = { db, clock, logger, storage: createLocalFileStorage(mediaDir) };
    const first = await runDevCatalogSeed(deps, { nodeEnv: "development" });
    expect(first.productsCreated).toBe(SAMPLE_PRODUCTS.length);
    expect(first.productsPublished).toBe(SAMPLE_PRODUCTS.length);

    const published = await db.product.count({ where: { status: "PUBLISHED" } });
    expect(published).toBe(SAMPLE_PRODUCTS.length);
    expect(await db.productMedia.count({ where: { isMain: true } })).toBe(SAMPLE_PRODUCTS.length);
    expect(await db.mediaAsset.count({ where: { scanStatus: { not: "SAFE" } } })).toBe(0);

    const variants = SAMPLE_PRODUCTS.flatMap((product) => product.variants);
    const balances = await db.inventoryBalance.findMany({
      include: { variant: { select: { sku: true, sellingPrice: true } } },
    });
    for (const sample of variants) {
      const balance = balances.find((row) => row.variant.sku === sample.sku);
      expect(balance?.availableQuantity).toBe(sample.stock);
      expect(balance?.variant.sellingPrice).toBe(BigInt(sample.price));
    }
    const stocked = variants.filter((variant) => variant.stock > 0).length;
    expect(await db.inventoryMovement.count()).toBe(stocked);

    const again = await runDevCatalogSeed(deps, { nodeEnv: "development" });
    expect(again).toEqual({
      brandsCreated: 0,
      categoriesCreated: 0,
      productsCreated: 0,
      productsPublished: 0,
    });
    expect(await db.inventoryMovement.count()).toBe(stocked);
    expect(await db.productMedia.count()).toBe(SAMPLE_PRODUCTS.length);
  });

  it("refuses to run in production", async () => {
    const deps = { db, clock, logger, storage: createLocalFileStorage(mediaDir) };
    await expect(runDevCatalogSeed(deps, { nodeEnv: "production" })).rejects.toThrow(
      /never runs with NODE_ENV=production/,
    );
  });
});
