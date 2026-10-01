import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { createLogger } from "@/server/logging/logger";
import { createProductsService } from "@/server/modules/catalog/products-service";
import {
  createTaxonomyService,
  MAX_CATEGORY_DEPTH,
} from "@/server/modules/catalog/taxonomy-service";
import { systemClock } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Brands, categories and product links against PostgreSQL (TASK-015, ADR-0020). */

const db = getDb();
const taxonomy = createTaxonomyService({ db, clock: systemClock });
const products = createProductsService({ db, clock: systemClock });
const logger = createLogger({ level: "error" });

let actor: { employeeId: string };

async function employeeId(): Promise<string> {
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `taxonomy-svc-${Math.random().toString(36).slice(2)}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: { create: { displayName: "Catalog", employeeLevel: "OWNER" } },
    },
    include: { employee: true },
  });
  return account.employee!.id;
}

function category(nameEn: string, parentId: string | null = null) {
  return taxonomy.createCategory(actor, { nameAr: "قسم", nameEn, parentId }, logger);
}

function reason(error: unknown): unknown {
  return (error as { details?: { reason?: string } }).details?.reason;
}

beforeEach(async () => {
  await resetDatabase();
  actor = { employeeId: await employeeId() };
});

afterAll(async () => {
  await db.$disconnect();
});

describe("history is kept", () => {
  it("rejects hard deletes of brands and categories", async () => {
    const brand = await taxonomy.createBrand(actor, { nameAr: "ماركة", nameEn: "Brand" }, logger);
    const makeup = await category("Makeup");
    await expect(db.brand.delete({ where: { id: brand.id } })).rejects.toThrow();
    await expect(db.category.delete({ where: { id: makeup.id } })).rejects.toThrow();
    expect(await db.brand.count()).toBe(1);
    expect(await db.category.count()).toBe(1);
  });

  it("refuses a category that is its own parent in the database", async () => {
    const makeup = await category("Makeup");
    await expect(
      db.category.update({ where: { id: makeup.id }, data: { parentId: makeup.id } }),
    ).rejects.toThrow();
  });
});

describe("category slugs", () => {
  it("are unique among siblings only", async () => {
    const makeup = await category("Makeup");
    const skincare = await category("Skincare");
    await category("Sets", makeup.id);
    await category("Sets", skincare.id);
    await category("Sets");
    await expect(category("Sets", makeup.id)).rejects.toSatisfy((e) => reason(e) === "SLUG_TAKEN");
    await expect(category("Sets")).rejects.toSatisfy((e) => reason(e) === "SLUG_TAKEN");
    // The database enforces it too, top level included.
    await expect(
      db.category.create({ data: { nameAr: "س", nameEn: "Sets", slug: "sets" } }),
    ).rejects.toThrow();
  });

  it("keep one of two simultaneous creations with the same slug", async () => {
    const results = await Promise.allSettled([category("Lips"), category("Lips")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(reason(rejected.reason)).toBe("SLUG_TAKEN");
    expect(await db.category.count()).toBe(1);
  });
});

describe("category tree", () => {
  it(`is at most ${MAX_CATEGORY_DEPTH} levels deep, also when moving a branch`, async () => {
    const makeup = await category("Makeup");
    const lips = await category("Lips", makeup.id);
    const lipstick = await category("Lipstick", lips.id);
    expect(lipstick.depth).toBe(3);
    await expect(category("Matte", lipstick.id)).rejects.toSatisfy(
      (e) => reason(e) === "CATEGORY_DEPTH_LIMIT",
    );

    // Moving "Lips" (2 levels) under another second-level category would make 4.
    const skincare = await category("Skincare");
    const face = await category("Face", skincare.id);
    await expect(
      taxonomy.updateCategory(actor, lips.id, { parentId: face.id }, logger),
    ).rejects.toSatisfy((e) => reason(e) === "CATEGORY_DEPTH_LIMIT");
    const moved = await taxonomy.updateCategory(actor, lips.id, { parentId: skincare.id }, logger);
    expect(moved).toMatchObject({ parentId: skincare.id, depth: 2 });
  });

  it("refuses moving a category under itself or a subcategory", async () => {
    const makeup = await category("Makeup");
    const lips = await category("Lips", makeup.id);
    for (const parentId of [makeup.id, lips.id]) {
      await expect(
        taxonomy.updateCategory(actor, makeup.id, { parentId }, logger),
      ).rejects.toSatisfy((e) => reason(e) === "CATEGORY_LOOP");
    }
  });

  it("keeps active categories under active parents", async () => {
    const makeup = await category("Makeup");
    const lips = await category("Lips", makeup.id);
    await expect(
      taxonomy.updateCategory(actor, makeup.id, { status: "INACTIVE" }, logger),
    ).rejects.toSatisfy((e) => reason(e) === "CATEGORY_HAS_ACTIVE_CHILDREN");

    await taxonomy.updateCategory(actor, lips.id, { status: "INACTIVE" }, logger);
    await taxonomy.updateCategory(actor, makeup.id, { status: "INACTIVE" }, logger);
    await expect(category("Eyes", makeup.id)).rejects.toSatisfy(
      (e) => reason(e) === "PARENT_INACTIVE",
    );
    await expect(
      taxonomy.updateCategory(actor, lips.id, { status: "ACTIVE" }, logger),
    ).rejects.toSatisfy((e) => reason(e) === "PARENT_INACTIVE");
    const other = await category("Nails");
    await expect(
      taxonomy.updateCategory(actor, other.id, { parentId: makeup.id }, logger),
    ).rejects.toSatisfy((e) => reason(e) === "PARENT_INACTIVE");

    // Reactivating the parent first, then the child, works.
    await taxonomy.updateCategory(actor, makeup.id, { status: "ACTIVE" }, logger);
    const back = await taxonomy.updateCategory(actor, lips.id, { status: "ACTIVE" }, logger);
    expect(back.status).toBe("ACTIVE");
  });

  it("lists parents before their children", async () => {
    const skincare = await category("Skincare");
    const makeup = await category("Makeup");
    await category("Lips", makeup.id);
    await category("Face", skincare.id);
    const list = await taxonomy.listCategories();
    expect(list.map((c) => [c.nameEn, c.depth])).toEqual([
      ["Makeup", 1],
      ["Lips", 2],
      ["Skincare", 1],
      ["Face", 2],
    ]);
  });
});

describe("product links", () => {
  it("cannot be made to an inactive brand or category, but existing links stay", async () => {
    const brand = await taxonomy.createBrand(actor, { nameAr: "ماركة", nameEn: "Brand" }, logger);
    const makeup = await category("Makeup");
    const product = await products.createProduct(
      actor,
      {
        nameAr: "منتج",
        nameEn: "Base",
        brandId: brand.id,
        categoryIds: [makeup.id],
        defaultVariant: { sku: "BASE-1" },
      },
      logger,
    );
    await taxonomy.updateBrand(actor, brand.id, { status: "INACTIVE" }, logger);
    await taxonomy.updateCategory(actor, makeup.id, { status: "INACTIVE" }, logger);

    const kept = await products.updateProduct(actor, product.id, { nameEn: "Base 2" }, logger);
    expect(kept.brand).toMatchObject({ id: brand.id, status: "INACTIVE" });
    expect(kept.categories).toMatchObject([{ id: makeup.id, status: "INACTIVE" }]);

    const other = await products.createProduct(
      actor,
      { nameAr: "منتج", nameEn: "Other", defaultVariant: { sku: "OTHER-1" } },
      logger,
    );
    await expect(
      products.updateProduct(actor, other.id, { brandId: brand.id }, logger),
    ).rejects.toSatisfy((e) => reason(e) === "BRAND_INACTIVE");
    await expect(
      products.updateProduct(actor, other.id, { categoryIds: [makeup.id] }, logger),
    ).rejects.toSatisfy((e) => reason(e) === "CATEGORY_INACTIVE");
  });
});
