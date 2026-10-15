import { beforeEach, describe, expect, it } from "vitest";
import { GET as listBrands } from "@/app/api/v1/brands/route";
import { GET as listCategories } from "@/app/api/v1/categories/route";
import { GET as getProduct } from "@/app/api/v1/products/[productId]/route";
import { GET as listProducts } from "@/app/api/v1/products/route";
import { getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of the public catalog (TASK-059, API §13 "Public", ADR-0059). */

const db = getDb();
const BASE = "http://localhost/api/v1";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: { lang?: string; params?: Record<string, string> } = {},
): Promise<Response> {
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      headers: { "accept-language": options.lang ?? "en" },
    }),
    { params: Promise.resolve(options.params ?? {}) as Promise<never> },
  );
}

async function body(res: Response, status = 200) {
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json;
}

let counter = 0;

/** A product with priced variants (`prices`), each holding `stock` units. */
async function product(
  options: {
    nameEn?: string;
    status?: "DRAFT" | "PUBLISHED" | "DISABLED" | "ARCHIVED";
    prices?: number[];
    stock?: number;
    brandId?: string;
    categoryId?: string;
    publishedAt?: Date;
  } = {},
) {
  counter += 1;
  const prices = options.prices ?? [15000];
  const created = await db.product.create({
    data: {
      nameAr: `منتج ${counter}`,
      nameEn: options.nameEn ?? `Product ${counter}`,
      slug: `product-${counter}`,
      descriptionEn: "Nice",
      descriptionAr: "جميل",
      status: options.status ?? "PUBLISHED",
      archivedAt: options.status === "ARCHIVED" ? new Date() : null,
      firstPublishedAt: options.publishedAt ?? new Date(Date.now() + counter * 1000),
      brandId: options.brandId,
      categories: options.categoryId ? { create: [{ categoryId: options.categoryId }] } : undefined,
      variants: {
        create: prices.map((price, i) => ({
          sku: `SKU-${counter}-${i}`,
          isDefault: i === 0,
          sellingPrice: BigInt(price),
          latestPurchaseCost: BigInt(1000),
          weightedAverageCost: BigInt(1000),
          variantNameEn: prices.length > 1 ? `Shade ${i}` : null,
          variantNameAr: prices.length > 1 ? `درجة ${i}` : null,
        })),
      },
    },
    include: { variants: true },
  });
  for (const variant of created.variants) {
    if ((options.stock ?? 5) > 0) {
      await db.inventoryMovement.create({
        data: {
          productVariantId: variant.id,
          movementType: "MANUAL_ADJUSTMENT",
          availableDelta: options.stock ?? 5,
          reason: "Test stock",
          createdByType: "SYSTEM",
        },
      });
    }
  }
  return created;
}

beforeEach(async () => {
  await resetDatabase();
  counter = 0;
});

describe("GET /products", () => {
  it("lists published products only, newest first, without costs or stock quantities", async () => {
    const older = await product({ prices: [20000, 10000] });
    const newer = await product({ stock: 0 });
    await product({ status: "DRAFT" });
    await product({ status: "DISABLED" });
    await product({ status: "ARCHIVED" });

    const json = await body(await call(listProducts, "/products"));
    expect(json.data.map((p: { id: string }) => p.id)).toEqual([newer.id, older.id]);
    expect(json.meta.pagination).toEqual({ page: 1, pageSize: 24, total: 2, totalPages: 1 });
    expect(json.data[1]).toMatchObject({
      slug: older.slug,
      name: older.nameEn,
      minPrice: 10000,
      maxPrice: 20000,
      currency: "EGP",
      variantCount: 2,
      status: "AVAILABLE",
      image: null,
      brand: null,
    });
    expect(json.data[0].status).toBe("OUT_OF_STOCK");
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/cost|availableQuantity/i);
  });

  it("returns names in the request language", async () => {
    await product();
    const json = await body(await call(listProducts, "/products", { lang: "ar" }));
    expect(json.data[0].name).toBe("منتج 1");
  });

  it("sorts by the lowest variant price and paginates", async () => {
    const a = await product({ prices: [30000] });
    const b = await product({ prices: [10000, 90000] });
    const c = await product({ prices: [20000] });

    const asc = await body(await call(listProducts, "/products?sort=price_asc"));
    expect(asc.data.map((p: { id: string }) => p.id)).toEqual([b.id, c.id, a.id]);

    const desc = await body(
      await call(listProducts, "/products?sort=price_desc&pageSize=2&page=2"),
    );
    expect(desc.data.map((p: { id: string }) => p.id)).toEqual([b.id]);
    expect(desc.meta.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });

  it("searches product and brand names, and filters by brand and category with subcategories", async () => {
    const brand = await db.brand.create({
      data: { nameAr: "لوريال", nameEn: "Loreal", slug: "loreal" },
    });
    const parent = await db.category.create({
      data: { nameAr: "مكياج", nameEn: "Makeup", slug: "makeup" },
    });
    const child = await db.category.create({
      data: { nameAr: "شفاه", nameEn: "Lips", slug: "lips", parentId: parent.id },
    });
    const lipstick = await product({ nameEn: "Velvet Lipstick", categoryId: child.id });
    const branded = await product({ nameEn: "Serum", brandId: brand.id });

    const ids = async (query: string) =>
      (await body(await call(listProducts, `/products?${query}`))).data.map(
        (p: { id: string }) => p.id,
      );
    expect(await ids("search=lipstick")).toEqual([lipstick.id]);
    expect(await ids("search=oreal")).toEqual([branded.id]);
    expect(await ids(`brandId=${brand.id}`)).toEqual([branded.id]);
    expect(await ids(`categoryId=${parent.id}`)).toEqual([lipstick.id]);
    expect(await ids(`categoryId=${child.id}`)).toEqual([lipstick.id]);

    await db.category.update({ where: { id: child.id }, data: { status: "INACTIVE" } });
    expect(await ids(`categoryId=${child.id}`)).toEqual([]);
  });

  it("refuses invalid query values", async () => {
    const error = (await body(await call(listProducts, "/products?pageSize=500&sort=x"), 400))
      .error;
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /products/{productId}", () => {
  it("returns a published product by id or slug with its sellable variants", async () => {
    const created = await product({ prices: [12000, 14000], stock: 0 });
    await db.productVariant.update({
      where: { id: created.variants[1].id },
      data: { status: "ARCHIVED", isDefault: false, archivedAt: new Date() },
    });

    for (const key of [created.id, created.slug]) {
      const json = await body(
        await call(getProduct, `/products/${key}`, { params: { productId: key } }),
      );
      expect(json.data).toMatchObject({
        id: created.id,
        name: created.nameEn,
        description: "Nice",
        minPrice: 12000,
        maxPrice: 12000,
        status: "OUT_OF_STOCK",
        images: [],
        categories: [],
      });
      expect(json.data.variants).toEqual([
        {
          id: created.variants[0].id,
          sku: created.variants[0].sku,
          name: "Shade 0",
          attributes: null,
          isDefault: true,
          price: 12000,
          status: "OUT_OF_STOCK",
        },
      ]);
      expect(JSON.stringify(json)).not.toMatch(/cost/i);
    }
  });

  it("hides products that are not published", async () => {
    const draft = await product({ status: "DRAFT" });
    for (const key of [draft.id, draft.slug, "no-such-product"]) {
      const json = await body(
        await call(getProduct, `/products/${key}`, { params: { productId: key } }),
        404,
      );
      expect(json.error.code).toBe("NOT_FOUND");
    }
  });
});

describe("GET /categories and GET /brands", () => {
  it("lists active categories in tree order and active brands by name", async () => {
    const parent = await db.category.create({
      data: { nameAr: "عطور", nameEn: "Perfume", slug: "perfume" },
    });
    const child = await db.category.create({
      data: { nameAr: "نسائي", nameEn: "Women", slug: "women", parentId: parent.id },
    });
    await db.category.create({
      data: { nameAr: "قديم", nameEn: "Old", slug: "old", status: "INACTIVE" },
    });
    await db.brand.create({ data: { nameAr: "ديور", nameEn: "Dior", slug: "dior" } });
    await db.brand.create({ data: { nameAr: "شانيل", nameEn: "Chanel", slug: "chanel" } });
    await db.brand.create({
      data: { nameAr: "قديم", nameEn: "Gone", slug: "gone", status: "INACTIVE" },
    });

    const categories = (await body(await call(listCategories, "/categories", { lang: "ar" }))).data;
    expect(categories).toEqual([
      { id: parent.id, slug: "perfume", name: "عطور", parentId: null, depth: 1 },
      { id: child.id, slug: "women", name: "نسائي", parentId: parent.id, depth: 2 },
    ]);

    const brands = (await body(await call(listBrands, "/brands"))).data;
    expect(brands.map((b: { name: string }) => b.name)).toEqual(["Chanel", "Dior"]);
  });
});
