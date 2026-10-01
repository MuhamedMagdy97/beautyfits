import {
  Prisma,
  type PrismaClient,
  type ProductStatus,
  type TaxonomyStatus,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import {
  loadActiveMedia,
  type MainImageView,
  type ProductMediaView,
  toMainImageView,
  toProductMediaView,
} from "@/server/modules/catalog/media-service";
import {
  assertProductChangeable,
  lockProduct,
  productNotFound,
} from "@/server/modules/catalog/product-guards";
import { slugFromName } from "@/server/modules/catalog/schemas";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Products and their variants (TASK-014, Business Spec C6, Q75, DB design §5,
 * ADR-0019).
 *
 * - A product is the container customers see; a variant is the canonical
 *   sellable unit (SKU, later price, cost and stock).
 * - Every product is created with exactly one default variant and always
 *   keeps one: the default can move to another active variant but cannot be
 *   archived.
 * - Nothing is hard-deleted: variants are archived (final in v1) and a
 *   database trigger rejects DELETE on both tables.
 * - Every change writes an audit entry in its transaction. Product changes
 *   need no approval request (Business Spec R19 limits approvals to purchase
 *   orders, over-delivery, campaigns and critical settings).
 *
 * - A product has at most one brand and is listed in up to
 *   `MAX_CATEGORIES_PER_PRODUCT` categories (TASK-015, ADR-0020). Only active
 *   brands and categories can be newly linked; existing links stay when a
 *   brand or category is deactivated.
 *
 * - Product views include the current images (TASK-016,
 *   `media-service.ts`); lists show the main image.
 *
 * New products are DRAFT; publishing, archiving and disabling products are
 * TASK-017. Prices and costs are TASK-018.
 */

/** A technical guard against runaway option lists (ADR-0019). */
export const MAX_VARIANTS_PER_PRODUCT = 100;

export interface CatalogActor {
  employeeId: string;
}

export interface VariantInput {
  sku: string;
  nameAr?: string | null;
  nameEn?: string | null;
  attributes?: Record<string, string> | null;
}

export interface ProductInput {
  nameAr: string;
  nameEn: string;
  slug?: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  brandId?: string | null;
  categoryIds?: string[];
  defaultVariant: VariantInput;
}

export type ProductChanges = Partial<Omit<ProductInput, "defaultVariant">>;

export type VariantChanges = Partial<VariantInput> & { isDefault?: true };

export interface VariantView {
  id: string;
  productId: string;
  sku: string;
  isDefault: boolean;
  nameAr: string | null;
  nameEn: string | null;
  attributes: Record<string, string> | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** A brand or category as shown on a product. */
export interface TaxonomyRef {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  status: TaxonomyStatus;
}

export interface CategoryRef extends TaxonomyRef {
  parentId: string | null;
}

export interface ProductView {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  status: ProductStatus;
  brand: TaxonomyRef | null;
  categories: CategoryRef[];
  variants: VariantView[];
  /** Current images in display order (TASK-016). */
  media: ProductMediaView[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ProductSummaryView {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  status: ProductStatus;
  brand: TaxonomyRef | null;
  mainImage: MainImageView | null;
  defaultVariant: { id: string; sku: string } | null;
  activeVariantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListQuery {
  page: number;
  pageSize: number;
  status?: ProductStatus;
  search?: string;
  brandId?: string;
  categoryId?: string;
}

export interface ProductsServiceDeps {
  db: PrismaClient;
  clock: Clock;
}

type VariantRow = Prisma.ProductVariantGetPayload<object>;
type ProductRow = Prisma.ProductGetPayload<object>;
type BrandRow = Prisma.BrandGetPayload<object>;
type CategoryRow = Prisma.CategoryGetPayload<object>;

type MediaRow = Awaited<ReturnType<typeof loadActiveMedia>>[number];

/** A product row with what its view shows besides the variants. */
interface ProductWithTaxonomy {
  product: ProductRow;
  brand: BrandRow | null;
  categories: CategoryRow[];
  media: MediaRow[];
}

const variantOrder = [{ createdAt: "asc" }, { id: "asc" }] as const;

function toVariantView(row: VariantRow): VariantView {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    isDefault: row.isDefault,
    nameAr: row.variantNameAr,
    nameEn: row.variantNameEn,
    attributes: (row.attributesJson as Record<string, string> | null) ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function toTaxonomyRef(row: BrandRow | CategoryRow): TaxonomyRef {
  return { id: row.id, nameAr: row.nameAr, nameEn: row.nameEn, slug: row.slug, status: row.status };
}

function toCategoryRef(row: CategoryRow): CategoryRef {
  return { ...toTaxonomyRef(row), parentId: row.parentId };
}

const byEnglishName = (a: { nameEn: string; id: string }, b: { nameEn: string; id: string }) =>
  a.nameEn.localeCompare(b.nameEn) || a.id.localeCompare(b.id);

function toProductView(
  { product: row, brand, categories, media }: ProductWithTaxonomy,
  variants: VariantRow[],
): ProductView {
  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    slug: row.slug,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    status: row.status,
    brand: brand ? toTaxonomyRef(brand) : null,
    categories: [...categories].sort(byEnglishName).map(toCategoryRef),
    variants: variants.map(toVariantView),
    media: media.map(toProductMediaView),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** What an audit entry records about a product. */
function productSnapshot(product: ProductRow, categoryIds: string[]) {
  return {
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    slug: product.slug,
    descriptionAr: product.descriptionAr,
    descriptionEn: product.descriptionEn,
    status: product.status,
    brandId: product.brandId,
    categoryIds: [...categoryIds].sort(),
  };
}

/** What an audit entry records about a variant. */
function variantSnapshot(variant: VariantRow) {
  return {
    productId: variant.productId,
    sku: variant.sku,
    isDefault: variant.isDefault,
    nameAr: variant.variantNameAr,
    nameEn: variant.variantNameEn,
    attributes: (variant.attributesJson as Record<string, string> | null) ?? null,
    status: variant.status,
  };
}

/**
 * Checks a brand about to be linked to a product: it must exist and be
 * active. `FOR SHARE` makes a concurrent deactivation wait for this
 * transaction, so the link is made against the status it checked.
 */
async function assertBrandLinkable(tx: Db, brandId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ status: TaxonomyStatus }[]>`
    SELECT status FROM brands WHERE id = ${brandId}::uuid FOR SHARE`;
  if (rows.length === 0) {
    throw validationError("brandId", "brand_not_found", "The brand does not exist.");
  }
  if (rows[0].status !== "ACTIVE") {
    throw conflict("The brand is inactive.", { reason: "BRAND_INACTIVE", brandId });
  }
}

/** Like `assertBrandLinkable`, for categories newly added to a product. */
async function assertCategoriesLinkable(tx: Db, categoryIds: string[]): Promise<void> {
  if (categoryIds.length === 0) {
    return;
  }
  const rows = await tx.$queryRaw<{ id: string; status: TaxonomyStatus }[]>`
    SELECT id::text AS id, status FROM categories
    WHERE id = ANY(${categoryIds}::uuid[]) ORDER BY id FOR SHARE`;
  const found = new Map(rows.map((row) => [row.id, row.status]));
  const missing = categoryIds.find((id) => !found.has(id));
  if (missing) {
    throw validationError("categoryIds", "category_not_found", "A category does not exist.");
  }
  const inactive = categoryIds.find((id) => found.get(id) !== "ACTIVE");
  if (inactive) {
    throw conflict("The category is inactive.", {
      reason: "CATEGORY_INACTIVE",
      categoryId: inactive,
    });
  }
}

function variantNotFound(): AppError {
  return new AppError("NOT_FOUND", "Variant not found.");
}

function slugTaken(slug: string): AppError {
  return conflict("Another product already uses this slug.", { reason: "SLUG_TAKEN", slug });
}

function skuTaken(sku: string): AppError {
  return conflict("Another variant already uses this SKU.", { reason: "SKU_TAKEN", sku });
}

function assertNamePair(nameAr: string | null, nameEn: string | null, path: string): void {
  if ((nameAr === null) !== (nameEn === null)) {
    throw validationError(
      `${path}${nameAr === null ? "nameAr" : "nameEn"}`,
      "variant_name_pair",
      "Give the variant name in both Arabic and English, or in neither.",
    );
  }
}

/** Maps a unique-index race (P2002) to the matching conflict. */
function mapUniqueViolation(error: unknown, values: { slug?: string; sku?: string }): unknown {
  if (values.sku !== undefined && isUniqueViolation(error, "sku")) {
    return skuTaken(values.sku);
  }
  if (values.slug !== undefined && isUniqueViolation(error, "slug")) {
    return slugTaken(values.slug);
  }
  return error;
}

async function assertSlugFree(tx: Db, slug: string, exceptId?: string): Promise<void> {
  const clash = await tx.product.findUnique({ where: { slug }, select: { id: true } });
  if (clash && clash.id !== exceptId) {
    throw slugTaken(slug);
  }
}

async function assertSkuFree(tx: Db, sku: string, exceptId?: string): Promise<void> {
  const clash = await tx.productVariant.findUnique({ where: { sku }, select: { id: true } });
  if (clash && clash.id !== exceptId) {
    throw skuTaken(sku);
  }
}

function sameAttributes(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function createProductsService(deps: ProductsServiceDeps) {
  const { db, clock } = deps;

  async function loadProductView(tx: Db, productId: string): Promise<ProductView> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { brand: true, categories: { include: { category: true } } },
    });
    if (!product) {
      throw productNotFound();
    }
    const variants = await tx.productVariant.findMany({
      where: { productId },
      orderBy: [...variantOrder],
    });
    const media = await loadActiveMedia(tx, productId);
    const { brand, categories, ...row } = product;
    return toProductView(
      { product: row, brand, categories: categories.map((link) => link.category), media },
      variants,
    );
  }

  async function createProduct(
    actor: CatalogActor,
    input: ProductInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ProductView> {
    const slug = input.slug ?? slugFromName(input.nameEn);
    if (slug === "") {
      throw validationError(
        "slug",
        "slug_required",
        "The English name has no Latin letters or digits; give a slug.",
      );
    }
    const variantInput = input.defaultVariant;
    const brandId = input.brandId ?? null;
    const categoryIds = input.categoryIds ?? [];
    const now = clock.now();
    const product = await runInTransaction(
      async (tx) => {
        await assertSlugFree(tx, slug);
        await assertSkuFree(tx, variantInput.sku);
        if (brandId !== null) {
          await assertBrandLinkable(tx, brandId);
        }
        await assertCategoriesLinkable(tx, categoryIds);
        let created: ProductRow;
        let variant: VariantRow;
        try {
          created = await tx.product.create({
            data: {
              nameAr: input.nameAr,
              nameEn: input.nameEn,
              slug,
              descriptionAr: input.descriptionAr ?? null,
              descriptionEn: input.descriptionEn ?? null,
              brandId,
              status: "DRAFT",
              createdAt: now,
              updatedAt: now,
            },
          });
          if (categoryIds.length > 0) {
            await tx.productCategory.createMany({
              data: categoryIds.map((categoryId) => ({
                productId: created.id,
                categoryId,
                createdAt: now,
              })),
            });
          }
          variant = await tx.productVariant.create({
            data: {
              productId: created.id,
              sku: variantInput.sku,
              isDefault: true,
              variantNameAr: variantInput.nameAr ?? null,
              variantNameEn: variantInput.nameEn ?? null,
              attributesJson: variantInput.attributes ?? Prisma.DbNull,
              status: "ACTIVE",
              createdAt: now,
              updatedAt: now,
            },
          });
        } catch (error) {
          throw mapUniqueViolation(error, { slug, sku: variantInput.sku });
        }
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_CREATED",
          entityType: AUDIT_ENTITY_TYPES.product,
          entityId: created.id,
          next: {
            ...productSnapshot(created, categoryIds),
            defaultVariant: variantSnapshot(variant),
          },
          correlationId,
          createdAt: now,
        });
        return loadProductView(tx, created.id);
      },
      {},
      db,
    );
    logger.info("product created", {
      productId: product.id,
      actorEmployeeId: actor.employeeId,
    });
    return product;
  }

  async function getProduct(productId: string): Promise<ProductView> {
    return loadProductView(db, productId);
  }

  async function listProducts(
    query: ProductListQuery,
  ): Promise<{ items: ProductSummaryView[]; pagination: Pagination }> {
    const search = query.search;
    const where: Prisma.ProductWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
      ...(search
        ? {
            OR: [
              { nameAr: { contains: search, mode: "insensitive" } },
              { nameEn: { contains: search, mode: "insensitive" } },
              { slug: { contains: search.toLowerCase() } },
              { variants: { some: { sku: { contains: search.toUpperCase() } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          brand: true,
          media: { where: { isMain: true, removedAt: null }, include: { mediaAsset: true } },
          variants: { where: { isDefault: true }, select: { id: true, sku: true } },
          _count: { select: { variants: { where: { status: "ACTIVE" } } } },
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        slug: row.slug,
        status: row.status,
        brand: row.brand ? toTaxonomyRef(row.brand) : null,
        mainImage: row.media[0] ? toMainImageView(row.media[0]) : null,
        defaultVariant: row.variants[0] ?? null,
        activeVariantCount: row._count.variants,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async function updateProduct(
    actor: CatalogActor,
    productId: string,
    input: ProductChanges,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ProductView> {
    const now = clock.now();
    const { view, changed } = await runInTransaction(
      async (tx) => {
        const existing = await lockProduct(tx, productId);
        assertProductChangeable(existing);
        const existingCategoryIds = (
          await tx.productCategory.findMany({
            where: { productId },
            select: { categoryId: true },
          })
        ).map((link) => link.categoryId);
        const data: Prisma.ProductUncheckedUpdateInput = {};
        if (input.brandId !== undefined && input.brandId !== existing.brandId) {
          if (input.brandId !== null) {
            await assertBrandLinkable(tx, input.brandId);
          }
          data.brandId = input.brandId;
        }
        const nextCategoryIds = input.categoryIds ?? existingCategoryIds;
        const addedCategoryIds = nextCategoryIds.filter((id) => !existingCategoryIds.includes(id));
        const removedCategoryIds = existingCategoryIds.filter(
          (id) => !nextCategoryIds.includes(id),
        );
        await assertCategoriesLinkable(tx, addedCategoryIds);
        if (input.nameAr !== undefined && input.nameAr !== existing.nameAr) {
          data.nameAr = input.nameAr;
        }
        if (input.nameEn !== undefined && input.nameEn !== existing.nameEn) {
          data.nameEn = input.nameEn;
        }
        if (input.descriptionAr !== undefined && input.descriptionAr !== existing.descriptionAr) {
          data.descriptionAr = input.descriptionAr;
        }
        if (input.descriptionEn !== undefined && input.descriptionEn !== existing.descriptionEn) {
          data.descriptionEn = input.descriptionEn;
        }
        if (input.slug !== undefined && input.slug !== existing.slug) {
          // Links and search results point at the slug once customers can see
          // the product, so it changes only while the product is a draft.
          if (existing.status !== "DRAFT") {
            throw conflict("The slug can only change while the product is a draft.", {
              reason: "SLUG_LOCKED",
            });
          }
          await assertSlugFree(tx, input.slug, productId);
          data.slug = input.slug;
        }
        const categoriesChange = addedCategoryIds.length > 0 || removedCategoryIds.length > 0;
        if (Object.keys(data).length === 0 && !categoriesChange) {
          return { view: await loadProductView(tx, productId), changed: false };
        }
        if (removedCategoryIds.length > 0) {
          await tx.productCategory.deleteMany({
            where: { productId, categoryId: { in: removedCategoryIds } },
          });
        }
        if (addedCategoryIds.length > 0) {
          await tx.productCategory.createMany({
            data: addedCategoryIds.map((categoryId) => ({ productId, categoryId, createdAt: now })),
          });
        }
        let updated: ProductRow;
        try {
          updated = await tx.product.update({
            where: { id: productId },
            data: { ...data, updatedAt: now },
          });
        } catch (error) {
          throw mapUniqueViolation(error, { slug: input.slug });
        }
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.product,
          entityId: productId,
          previous: productSnapshot(existing, existingCategoryIds),
          next: productSnapshot(updated, nextCategoryIds),
          correlationId,
          createdAt: now,
        });
        return { view: await loadProductView(tx, productId), changed: true };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("product updated", { productId, actorEmployeeId: actor.employeeId });
    }
    return view;
  }

  async function listVariants(productId: string): Promise<VariantView[]> {
    const product = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) {
      throw productNotFound();
    }
    const rows = await db.productVariant.findMany({
      where: { productId },
      orderBy: [...variantOrder],
    });
    return rows.map(toVariantView);
  }

  async function createVariant(
    actor: CatalogActor,
    productId: string,
    input: VariantInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<VariantView> {
    const now = clock.now();
    const variant = await runInTransaction(
      async (tx) => {
        const product = await lockProduct(tx, productId);
        assertProductChangeable(product);
        const count = await tx.productVariant.count({ where: { productId } });
        if (count >= MAX_VARIANTS_PER_PRODUCT) {
          throw conflict(`A product can have at most ${MAX_VARIANTS_PER_PRODUCT} variants.`, {
            reason: "VARIANT_LIMIT",
            limit: MAX_VARIANTS_PER_PRODUCT,
          });
        }
        await assertSkuFree(tx, input.sku);
        let created: VariantRow;
        try {
          created = await tx.productVariant.create({
            data: {
              productId,
              sku: input.sku,
              isDefault: false,
              variantNameAr: input.nameAr ?? null,
              variantNameEn: input.nameEn ?? null,
              attributesJson: input.attributes ?? Prisma.DbNull,
              status: "ACTIVE",
              createdAt: now,
              updatedAt: now,
            },
          });
        } catch (error) {
          throw mapUniqueViolation(error, { sku: input.sku });
        }
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_VARIANT_CREATED",
          entityType: AUDIT_ENTITY_TYPES.productVariant,
          entityId: created.id,
          next: variantSnapshot(created),
          correlationId,
          createdAt: now,
        });
        return created;
      },
      {},
      db,
    );
    logger.info("product variant created", {
      productId,
      variantId: variant.id,
      actorEmployeeId: actor.employeeId,
    });
    return toVariantView(variant);
  }

  /** Finds the variant and locks its product. */
  async function lockVariant(
    tx: Db,
    variantId: string,
  ): Promise<{ product: ProductRow; variant: VariantRow }> {
    const found = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    if (!found) {
      throw variantNotFound();
    }
    const product = await lockProduct(tx, found.productId);
    const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    return { product, variant };
  }

  function assertVariantActive(variant: VariantRow): void {
    if (variant.status === "ARCHIVED") {
      throw conflict("This variant is archived and can no longer be changed.", {
        reason: "VARIANT_ARCHIVED",
      });
    }
  }

  async function updateVariant(
    actor: CatalogActor,
    variantId: string,
    input: VariantChanges,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<VariantView> {
    const now = clock.now();
    const { view, changed } = await runInTransaction(
      async (tx) => {
        const { product, variant } = await lockVariant(tx, variantId);
        assertProductChangeable(product);
        assertVariantActive(variant);

        const nameAr = input.nameAr !== undefined ? input.nameAr : variant.variantNameAr;
        const nameEn = input.nameEn !== undefined ? input.nameEn : variant.variantNameEn;
        assertNamePair(nameAr, nameEn, "");

        const data: Prisma.ProductVariantUncheckedUpdateInput = {};
        if (nameAr !== variant.variantNameAr) {
          data.variantNameAr = nameAr;
        }
        if (nameEn !== variant.variantNameEn) {
          data.variantNameEn = nameEn;
        }
        const currentAttributes = variant.attributesJson as Record<string, string> | null;
        if (
          input.attributes !== undefined &&
          !sameAttributes(input.attributes, currentAttributes)
        ) {
          data.attributesJson = input.attributes ?? Prisma.DbNull;
        }
        if (input.sku !== undefined && input.sku !== variant.sku) {
          await assertSkuFree(tx, input.sku, variantId);
          data.sku = input.sku;
        }
        const movesDefault = input.isDefault === true && !variant.isDefault;
        if (Object.keys(data).length === 0 && !movesDefault) {
          return { view: toVariantView(variant), changed: false };
        }

        let previousDefault: VariantRow | null = null;
        if (movesDefault) {
          previousDefault = await tx.productVariant.findFirst({
            where: { productId: product.id, isDefault: true },
          });
          if (previousDefault) {
            await tx.productVariant.update({
              where: { id: previousDefault.id },
              data: { isDefault: false, updatedAt: now },
            });
          }
          data.isDefault = true;
        }
        let updated: VariantRow;
        try {
          updated = await tx.productVariant.update({
            where: { id: variantId },
            data: { ...data, updatedAt: now },
          });
        } catch (error) {
          throw mapUniqueViolation(error, { sku: input.sku });
        }
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_VARIANT_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.productVariant,
          entityId: variantId,
          previous: {
            ...variantSnapshot(variant),
            ...(previousDefault ? { previousDefaultVariantId: previousDefault.id } : {}),
          },
          next: variantSnapshot(updated),
          correlationId,
          createdAt: now,
        });
        return { view: toVariantView(updated), changed: true };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("product variant updated", {
        variantId,
        actorEmployeeId: actor.employeeId,
        movedDefault: input.isDefault === true,
      });
    }
    return view;
  }

  async function archiveVariant(
    actor: CatalogActor,
    variantId: string,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<VariantView> {
    const now = clock.now();
    const { view, changed } = await runInTransaction(
      async (tx) => {
        const { product, variant } = await lockVariant(tx, variantId);
        if (variant.status === "ARCHIVED") {
          // Repeating the archive is harmless: same result, no new entry.
          return { view: toVariantView(variant), changed: false };
        }
        assertProductChangeable(product);
        if (variant.isDefault) {
          throw conflict(
            "The default variant cannot be archived. Make another variant the default first, or archive the product.",
            { reason: "VARIANT_IS_DEFAULT" },
          );
        }
        const updated = await tx.productVariant.update({
          where: { id: variantId },
          data: { status: "ARCHIVED", archivedAt: now, updatedAt: now },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_VARIANT_ARCHIVED",
          entityType: AUDIT_ENTITY_TYPES.productVariant,
          entityId: variantId,
          previous: variantSnapshot(variant),
          next: variantSnapshot(updated),
          correlationId,
          createdAt: now,
        });
        return { view: toVariantView(updated), changed: true };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("product variant archived", { variantId, actorEmployeeId: actor.employeeId });
    }
    return view;
  }

  return {
    createProduct,
    getProduct,
    listProducts,
    updateProduct,
    listVariants,
    createVariant,
    updateVariant,
    archiveVariant,
  };
}

export type ProductsService = ReturnType<typeof createProductsService>;

let defaultService: ProductsService | undefined;

export function getProductsService(): ProductsService {
  defaultService ??= createProductsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
