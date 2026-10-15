import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import type { Pagination } from "@/server/http/response";
import { getTaxonomyService } from "@/server/modules/catalog/taxonomy-service";
import { withSubcategories } from "@/server/modules/discounts/engine";
import { localName } from "@/server/modules/locations/locations-service";
import { mediaContentUrl } from "@/server/modules/media/uploads-service";
import { toJsonNumber } from "@/server/money/money";

/**
 * Public catalog for the website and the mobile app (TASK-059, API §13
 * "Public", ADR-0059).
 *
 * - Only `PUBLISHED` products and their active, priced variants are shown;
 *   everything else is `404 NOT_FOUND`, as if it did not exist.
 * - Prices are the current selling prices (tax-inclusive, piastres). No cost
 *   fields and no stock quantities: only `AVAILABLE` / `OUT_OF_STOCK` (Q20:
 *   out-of-stock products stay visible). Discounts are never applied here; a
 *   shopper chooses one in the cart (Q138).
 * - Names and descriptions come in the request language (R14).
 */

export type StockStatus = "AVAILABLE" | "OUT_OF_STOCK";
export type ProductSort = "newest" | "price_asc" | "price_desc";

export interface PublicImage {
  url: string;
  width: number;
  height: number;
  alt: string | null;
}

export interface PublicBrandRef {
  id: string;
  slug: string;
  name: string;
}

export interface PublicProductSummary {
  id: string;
  slug: string;
  name: string;
  brand: PublicBrandRef | null;
  image: PublicImage | null;
  /** Lowest and highest price of the sellable variants. */
  minPrice: number;
  maxPrice: number;
  currency: "EGP";
  variantCount: number;
  /** `AVAILABLE` when any variant has stock. */
  status: StockStatus;
}

export interface PublicVariant {
  id: string;
  sku: string;
  name: string | null;
  attributes: Record<string, string> | null;
  isDefault: boolean;
  price: number;
  status: StockStatus;
}

export interface PublicProduct extends Omit<PublicProductSummary, "image" | "variantCount"> {
  description: string | null;
  categories: { id: string; slug: string; name: string }[];
  images: (PublicImage & { variantId: string | null })[];
  variants: PublicVariant[];
}

export interface ProductQuery {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  brandId?: string;
  sort: ProductSort;
}

const PUBLISHED: Prisma.ProductWhereInput = { status: "PUBLISHED" };
const SELLABLE_VARIANT: Prisma.ProductVariantWhereInput = {
  status: "ACTIVE",
  sellingPrice: { not: null },
};

const PRODUCT_INCLUDE = {
  brand: true,
  media: {
    where: { removedAt: null },
    include: { mediaAsset: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  },
  variants: {
    where: SELLABLE_VARIANT,
    include: { inventoryBalance: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;
type MediaRow = ProductRow["media"][number];
type VariantRow = ProductRow["variants"][number];

function notFound(): AppError {
  return new AppError("NOT_FOUND", "Product not found.");
}

function image(row: MediaRow, locale: SupportedLocale): PublicImage {
  return {
    url: mediaContentUrl(row.mediaAssetId),
    width: row.mediaAsset.width ?? 0,
    height: row.mediaAsset.height ?? 0,
    alt: locale === "ar" ? row.altTextAr : row.altTextEn,
  };
}

function stock(variant: VariantRow): StockStatus {
  return (variant.inventoryBalance?.availableQuantity ?? 0) > 0 ? "AVAILABLE" : "OUT_OF_STOCK";
}

function brandRef(row: ProductRow["brand"], locale: SupportedLocale): PublicBrandRef | null {
  return row && row.status === "ACTIVE"
    ? { id: row.id, slug: row.slug, name: localName(row, locale) }
    : null;
}

/** Shared summary fields; null when no variant can be sold (not shown at all). */
function summarize(row: ProductRow, locale: SupportedLocale) {
  if (row.variants.length === 0) {
    return null;
  }
  const prices = row.variants.map((v) => toJsonNumber(v.sellingPrice!));
  return {
    id: row.id,
    slug: row.slug,
    name: localName(row, locale),
    brand: brandRef(row.brand, locale),
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    currency: "EGP" as const,
    status: row.variants.some((v) => stock(v) === "AVAILABLE")
      ? ("AVAILABLE" as const)
      : ("OUT_OF_STOCK" as const),
  };
}

export function toProductSummary(
  row: ProductRow,
  locale: SupportedLocale,
): PublicProductSummary | null {
  const base = summarize(row, locale);
  if (!base) {
    return null;
  }
  const main = row.media.find((m) => m.isMain) ?? row.media[0];
  return {
    ...base,
    image: main ? image(main, locale) : null,
    variantCount: row.variants.length,
  };
}

export function createStorefrontCatalogService(deps: { db: PrismaClient }) {
  const { db } = deps;

  /** Published products whose filters match, as a Prisma filter. */
  async function productFilter(query: ProductQuery): Promise<Prisma.ProductWhereInput> {
    const and: Prisma.ProductWhereInput[] = [PUBLISHED, { variants: { some: SELLABLE_VARIANT } }];
    if (query.brandId) {
      and.push({ brandId: query.brandId, brand: { status: "ACTIVE" } });
    }
    if (query.categoryId) {
      // A category lists its subcategories' products too (as discounts do, R36).
      const active = await db.category.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, parentId: true },
      });
      const ids = active.some((c) => c.id === query.categoryId)
        ? [...withSubcategories([query.categoryId], active)]
        : [];
      and.push({ categories: { some: { categoryId: { in: ids } } } });
    }
    if (query.search) {
      const text = { contains: query.search, mode: "insensitive" } as const;
      and.push({
        OR: [
          { nameAr: text },
          { nameEn: text },
          { brand: { status: "ACTIVE", OR: [{ nameAr: text }, { nameEn: text }] } },
        ],
      });
    }
    return { AND: and };
  }

  /** `GET /products`. */
  async function listProducts(
    query: ProductQuery,
    locale: SupportedLocale,
  ): Promise<{ items: PublicProductSummary[]; pagination: Pagination }> {
    const where = await productFilter(query);
    const skip = (query.page - 1) * query.pageSize;
    let ids: string[];
    let total: number;
    if (query.sort === "newest") {
      const [count, rows] = await Promise.all([
        db.product.count({ where }),
        db.product.findMany({
          where,
          select: { id: true },
          orderBy: [{ firstPublishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
          skip,
          take: query.pageSize,
        }),
      ]);
      total = count;
      ids = rows.map((row) => row.id);
    } else {
      // Ordered by the product's lowest variant price.
      const direction = query.sort === "price_asc" ? "asc" : "desc";
      const [count, groups] = await Promise.all([
        db.product.count({ where }),
        db.productVariant.groupBy({
          by: ["productId"],
          where: { ...SELLABLE_VARIANT, product: { is: where } },
          _min: { sellingPrice: true },
          orderBy: [{ _min: { sellingPrice: direction } }, { productId: "asc" }],
          skip,
          take: query.pageSize,
        }),
      ]);
      total = count;
      ids = groups.map((group) => group.productId);
    }
    const rows = await db.product.findMany({
      where: { id: { in: ids } },
      include: PRODUCT_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids
      .map((id) => byId.get(id))
      .map((row) => (row ? toProductSummary(row, locale) : null))
      .filter((item): item is PublicProductSummary => item !== null);
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  /** `GET /products/{idOrSlug}`. */
  async function getProduct(idOrSlug: string, locale: SupportedLocale): Promise<PublicProduct> {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const row = await db.product.findFirst({
      where: { ...PUBLISHED, ...(isId ? { id: idOrSlug } : { slug: idOrSlug }) },
      include: {
        ...PRODUCT_INCLUDE,
        categories: { where: { category: { status: "ACTIVE" } }, include: { category: true } },
      },
    });
    const base = row ? summarize(row, locale) : null;
    if (!row || !base) {
      throw notFound();
    }
    return {
      ...base,
      description: locale === "ar" ? row.descriptionAr : row.descriptionEn,
      categories: row.categories.map(({ category }) => ({
        id: category.id,
        slug: category.slug,
        name: localName(category, locale),
      })),
      // The main image first, then the others in their order.
      images: [...row.media]
        .sort((a, b) => Number(b.isMain) - Number(a.isMain))
        .map((m) => ({ ...image(m, locale), variantId: m.variantId })),
      variants: row.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: locale === "ar" ? v.variantNameAr : v.variantNameEn,
        attributes: (v.attributesJson as Record<string, string> | null) ?? null,
        isDefault: v.isDefault,
        price: toJsonNumber(v.sellingPrice!),
        status: stock(v),
      })),
    };
  }

  /** `GET /categories`: active categories in tree order. */
  async function listCategories(locale: SupportedLocale) {
    const tree = await getTaxonomyService().listCategories({ status: "ACTIVE" });
    return tree.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: localName(c, locale),
      parentId: c.parentId,
      depth: c.depth,
    }));
  }

  /** `GET /brands`: active brands by name. */
  async function listBrands(locale: SupportedLocale) {
    const rows = await db.brand.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ nameEn: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: localName(row, locale),
      description: locale === "ar" ? row.descriptionAr : row.descriptionEn,
    }));
  }

  return { listProducts, getProduct, listCategories, listBrands };
}

export type StorefrontCatalogService = ReturnType<typeof createStorefrontCatalogService>;

let defaultService: StorefrontCatalogService | undefined;

export function getStorefrontCatalogService(): StorefrontCatalogService {
  defaultService ??= createStorefrontCatalogService({ db: getDb() });
  return defaultService;
}
