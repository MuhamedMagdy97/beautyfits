import { Prisma, type PrismaClient, type TaxonomyStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import type { CatalogActor } from "@/server/modules/catalog/products-service";
import { slugFromName } from "@/server/modules/catalog/schemas";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Brands and categories (TASK-015, DB design §5, API §13, ADR-0020).
 *
 * - Brands are a flat list; categories form a tree of at most
 *   `MAX_CATEGORY_DEPTH` levels. A product has at most one brand and may be
 *   listed in several categories (products-service).
 * - Nothing is hard-deleted: brands and categories are deactivated (and can
 *   be reactivated); a database trigger rejects DELETE on both tables.
 * - An active category always has active ancestors: a category with active
 *   subcategories cannot be deactivated, and nothing active goes under an
 *   inactive parent.
 * - Every change writes an audit entry in its transaction. No approval
 *   requests (Business Spec R19).
 */

/** Top level, subcategory, sub-subcategory (ADR-0020). */
export const MAX_CATEGORY_DEPTH = 3;

export interface BrandInput {
  nameAr: string;
  nameEn: string;
  slug?: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
}

export type BrandChanges = Partial<BrandInput> & { status?: TaxonomyStatus };

export interface CategoryInput {
  nameAr: string;
  nameEn: string;
  slug?: string;
  parentId?: string | null;
}

export type CategoryChanges = Partial<CategoryInput> & { status?: TaxonomyStatus };

export interface BrandView {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  status: TaxonomyStatus;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryView {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  parentId: string | null;
  /** 1 for a top-level category. */
  depth: number;
  status: TaxonomyStatus;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrandListQuery {
  page: number;
  pageSize: number;
  status?: TaxonomyStatus;
  search?: string;
}

export interface TaxonomyServiceDeps {
  db: PrismaClient;
  clock: Clock;
}

type BrandRow = Prisma.BrandGetPayload<object>;
type CategoryRow = Prisma.CategoryGetPayload<object>;

function brandNotFound(): AppError {
  return new AppError("NOT_FOUND", "Brand not found.");
}

function categoryNotFound(): AppError {
  return new AppError("NOT_FOUND", "Category not found.");
}

function brandSlugTaken(slug: string): AppError {
  return conflict("Another brand already uses this slug.", { reason: "SLUG_TAKEN", slug });
}

function categorySlugTaken(slug: string): AppError {
  return conflict("Another category with the same parent already uses this slug.", {
    reason: "SLUG_TAKEN",
    slug,
  });
}

function slugOrDerived(slug: string | undefined, nameEn: string): string {
  const value = slug ?? slugFromName(nameEn);
  if (value === "") {
    throw validationError(
      "slug",
      "slug_required",
      "The English name has no Latin letters or digits; give a slug.",
    );
  }
  return value;
}

function brandSnapshot(brand: BrandRow) {
  return {
    nameAr: brand.nameAr,
    nameEn: brand.nameEn,
    slug: brand.slug,
    descriptionAr: brand.descriptionAr,
    descriptionEn: brand.descriptionEn,
    status: brand.status,
  };
}

function categorySnapshot(category: CategoryRow) {
  return {
    nameAr: category.nameAr,
    nameEn: category.nameEn,
    slug: category.slug,
    parentId: category.parentId,
    status: category.status,
  };
}

function toBrandView(row: BrandRow, productCount: number): BrandView {
  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    slug: row.slug,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    status: row.status,
    productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCategoryView(row: CategoryRow, depth: number, productCount: number): CategoryView {
  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    slug: row.slug,
    parentId: row.parentId,
    depth,
    status: row.status,
    productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The category tree, loaded whole: it is small (tens to a few hundred rows)
 * and every structural check (depth, loops, active ancestors) needs it.
 */
class CategoryTree {
  private readonly byId: Map<string, CategoryRow>;

  constructor(rows: CategoryRow[]) {
    this.byId = new Map(rows.map((row) => [row.id, row]));
  }

  all(): CategoryRow[] {
    return [...this.byId.values()];
  }

  get(id: string): CategoryRow | undefined {
    return this.byId.get(id);
  }

  /** 1 for a top-level category. */
  depth(id: string): number {
    let depth = 0;
    let current = this.byId.get(id);
    while (current) {
      depth += 1;
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    return depth;
  }

  children(id: string): CategoryRow[] {
    return this.all().filter((row) => row.parentId === id);
  }

  /** Levels below `id`: 0 for a category without subcategories. */
  height(id: string): number {
    const children = this.children(id);
    return children.length === 0 ? 0 : 1 + Math.max(...children.map((c) => this.height(c.id)));
  }

  /** Whether `id` is `ancestorId` or lies under it. */
  isWithin(id: string, ancestorId: string): boolean {
    let current = this.byId.get(id);
    while (current) {
      if (current.id === ancestorId) {
        return true;
      }
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    return false;
  }
}

/**
 * Category writes run one at a time, so the structural checks (depth, loops,
 * active parents and children) always see the tree they change.
 */
async function lockCategoryTree(tx: Db): Promise<CategoryTree> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog:category-tree'))`;
  return new CategoryTree(await tx.category.findMany());
}

function parentInactive(): AppError {
  return conflict("The parent category is inactive; activate it first.", {
    reason: "PARENT_INACTIVE",
  });
}

function depthExceeded(): AppError {
  return conflict(`Categories can be at most ${MAX_CATEGORY_DEPTH} levels deep.`, {
    reason: "CATEGORY_DEPTH_LIMIT",
    limit: MAX_CATEGORY_DEPTH,
  });
}

/** Parent must exist (else a validation error naming `parentId`). */
function requireParent(tree: CategoryTree, parentId: string): CategoryRow {
  const parent = tree.get(parentId);
  if (!parent) {
    throw validationError("parentId", "category_not_found", "The parent category does not exist.");
  }
  return parent;
}

/** Slugs are unique among siblings: the same parent, or both top-level. */
function assertSiblingSlugFree(
  tree: CategoryTree,
  parentId: string | null,
  slug: string,
  exceptId?: string,
): void {
  if (
    tree.all().some((row) => row.parentId === parentId && row.slug === slug && row.id !== exceptId)
  ) {
    throw categorySlugTaken(slug);
  }
}

export function createTaxonomyService(deps: TaxonomyServiceDeps) {
  const { db, clock } = deps;

  async function brandProductCount(tx: Db, brandId: string): Promise<number> {
    return tx.product.count({ where: { brandId } });
  }

  async function categoryProductCount(tx: Db, categoryId: string): Promise<number> {
    return tx.productCategory.count({ where: { categoryId } });
  }

  // -------------------------------------------------------------------------
  // Brands
  // -------------------------------------------------------------------------

  async function createBrand(
    actor: CatalogActor,
    input: BrandInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<BrandView> {
    const slug = slugOrDerived(input.slug, input.nameEn);
    const now = clock.now();
    const brand = await runInTransaction(
      async (tx) => {
        if (await tx.brand.findUnique({ where: { slug }, select: { id: true } })) {
          throw brandSlugTaken(slug);
        }
        let created: BrandRow;
        try {
          created = await tx.brand.create({
            data: {
              nameAr: input.nameAr,
              nameEn: input.nameEn,
              slug,
              descriptionAr: input.descriptionAr ?? null,
              descriptionEn: input.descriptionEn ?? null,
              status: "ACTIVE",
              createdAt: now,
              updatedAt: now,
            },
          });
        } catch (error) {
          throw isUniqueViolation(error, "slug") ? brandSlugTaken(slug) : error;
        }
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "BRAND_CREATED",
          entityType: AUDIT_ENTITY_TYPES.brand,
          entityId: created.id,
          next: brandSnapshot(created),
          correlationId,
          createdAt: now,
        });
        return toBrandView(created, 0);
      },
      {},
      db,
    );
    logger.info("brand created", { brandId: brand.id, actorEmployeeId: actor.employeeId });
    return brand;
  }

  async function listBrands(
    query: BrandListQuery,
  ): Promise<{ items: BrandView[]; pagination: Pagination }> {
    const search = query.search;
    const where: Prisma.BrandWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { nameAr: { contains: search, mode: "insensitive" } },
              { nameEn: { contains: search, mode: "insensitive" } },
              { slug: { contains: search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      db.brand.count({ where }),
      db.brand.findMany({
        where,
        orderBy: [{ nameEn: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { products: true } } },
      }),
    ]);
    return {
      items: rows.map((row) => toBrandView(row, row._count.products)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async function updateBrand(
    actor: CatalogActor,
    brandId: string,
    input: BrandChanges,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<BrandView> {
    const now = clock.now();
    const { view, changed } = await runInTransaction(
      async (tx) => {
        // Row lock: a product being linked to this brand at the same moment
        // (products-service, FOR SHARE) sees either the old or the new status.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM brands WHERE id = ${brandId}::uuid FOR UPDATE`;
        if (locked.length === 0) {
          throw brandNotFound();
        }
        const existing = await tx.brand.findUniqueOrThrow({ where: { id: brandId } });
        const data: Prisma.BrandUpdateInput = {};
        for (const key of [
          "nameAr",
          "nameEn",
          "descriptionAr",
          "descriptionEn",
          "status",
        ] as const) {
          if (input[key] !== undefined && input[key] !== existing[key]) {
            Object.assign(data, { [key]: input[key] });
          }
        }
        if (input.slug !== undefined && input.slug !== existing.slug) {
          const clash = await tx.brand.findUnique({
            where: { slug: input.slug },
            select: { id: true },
          });
          if (clash) {
            throw brandSlugTaken(input.slug);
          }
          data.slug = input.slug;
        }
        if (Object.keys(data).length === 0) {
          return {
            view: toBrandView(existing, await brandProductCount(tx, brandId)),
            changed: false,
          };
        }
        let updated: BrandRow;
        try {
          updated = await tx.brand.update({
            where: { id: brandId },
            data: { ...data, updatedAt: now },
          });
        } catch (error) {
          throw isUniqueViolation(error, "slug") && input.slug ? brandSlugTaken(input.slug) : error;
        }
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "BRAND_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.brand,
          entityId: brandId,
          previous: brandSnapshot(existing),
          next: brandSnapshot(updated),
          correlationId,
          createdAt: now,
        });
        return {
          view: toBrandView(updated, await brandProductCount(tx, brandId)),
          changed: true,
        };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("brand updated", { brandId, actorEmployeeId: actor.employeeId });
    }
    return view;
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async function createCategory(
    actor: CatalogActor,
    input: CategoryInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<CategoryView> {
    const slug = slugOrDerived(input.slug, input.nameEn);
    const parentId = input.parentId ?? null;
    const now = clock.now();
    const category = await runInTransaction(
      async (tx) => {
        const tree = await lockCategoryTree(tx);
        let depth = 1;
        if (parentId !== null) {
          const parent = requireParent(tree, parentId);
          if (parent.status !== "ACTIVE") {
            throw parentInactive();
          }
          depth = tree.depth(parentId) + 1;
          if (depth > MAX_CATEGORY_DEPTH) {
            throw depthExceeded();
          }
        }
        assertSiblingSlugFree(tree, parentId, slug);
        let created: CategoryRow;
        try {
          created = await tx.category.create({
            data: {
              nameAr: input.nameAr,
              nameEn: input.nameEn,
              slug,
              parentId,
              status: "ACTIVE",
              createdAt: now,
              updatedAt: now,
            },
          });
        } catch (error) {
          throw isUniqueViolation(error, "slug") ? categorySlugTaken(slug) : error;
        }
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "CATEGORY_CREATED",
          entityType: AUDIT_ENTITY_TYPES.category,
          entityId: created.id,
          next: categorySnapshot(created),
          correlationId,
          createdAt: now,
        });
        return toCategoryView(created, depth, 0);
      },
      {},
      db,
    );
    logger.info("category created", {
      categoryId: category.id,
      actorEmployeeId: actor.employeeId,
    });
    return category;
  }

  /** Every category, parents before children, siblings by English name. */
  async function listCategories(query: { status?: TaxonomyStatus } = {}): Promise<CategoryView[]> {
    const rows = await db.category.findMany({
      orderBy: [{ nameEn: "asc" }, { id: "asc" }],
      include: { _count: { select: { products: true } } },
    });
    const tree = new CategoryTree(rows);
    const counts = new Map(rows.map((row) => [row.id, row._count.products]));
    const ordered: CategoryView[] = [];
    const visit = (parentId: string | null) => {
      for (const row of rows) {
        if (row.parentId === parentId) {
          ordered.push(toCategoryView(row, tree.depth(row.id), counts.get(row.id) ?? 0));
          visit(row.id);
        }
      }
    };
    visit(null);
    return query.status ? ordered.filter((c) => c.status === query.status) : ordered;
  }

  async function updateCategory(
    actor: CatalogActor,
    categoryId: string,
    input: CategoryChanges,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<CategoryView> {
    const now = clock.now();
    const { view, changed } = await runInTransaction(
      async (tx) => {
        const tree = await lockCategoryTree(tx);
        const existing = tree.get(categoryId);
        if (!existing) {
          throw categoryNotFound();
        }
        // Row lock: see updateBrand.
        await tx.$queryRaw`SELECT id FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE`;

        const parentId = input.parentId !== undefined ? input.parentId : existing.parentId;
        const status = input.status ?? existing.status;
        const slug = input.slug ?? existing.slug;

        const moves = parentId !== existing.parentId;
        if (moves && parentId !== null) {
          const parent = requireParent(tree, parentId);
          if (tree.isWithin(parentId, categoryId)) {
            throw conflict("A category cannot be moved under itself or its subcategories.", {
              reason: "CATEGORY_LOOP",
            });
          }
          if (tree.depth(parentId) + 1 + tree.height(categoryId) > MAX_CATEGORY_DEPTH) {
            throw depthExceeded();
          }
          if (status === "ACTIVE" && parent.status !== "ACTIVE") {
            throw parentInactive();
          }
        }
        if (status === "ACTIVE" && existing.status !== "ACTIVE" && parentId !== null) {
          if (tree.get(parentId)?.status !== "ACTIVE") {
            throw parentInactive();
          }
        }
        if (status === "INACTIVE" && existing.status === "ACTIVE") {
          if (tree.children(categoryId).some((child) => child.status === "ACTIVE")) {
            throw conflict("Deactivate or move its active subcategories first.", {
              reason: "CATEGORY_HAS_ACTIVE_CHILDREN",
            });
          }
        }
        if (moves || slug !== existing.slug) {
          assertSiblingSlugFree(tree, parentId, slug, categoryId);
        }

        const data: Prisma.CategoryUncheckedUpdateInput = {};
        if (input.nameAr !== undefined && input.nameAr !== existing.nameAr) {
          data.nameAr = input.nameAr;
        }
        if (input.nameEn !== undefined && input.nameEn !== existing.nameEn) {
          data.nameEn = input.nameEn;
        }
        if (slug !== existing.slug) {
          data.slug = slug;
        }
        if (moves) {
          data.parentId = parentId;
        }
        if (status !== existing.status) {
          data.status = status;
        }
        const productCount = await categoryProductCount(tx, categoryId);
        if (Object.keys(data).length === 0) {
          return {
            view: toCategoryView(existing, tree.depth(categoryId), productCount),
            changed: false,
          };
        }
        let updated: CategoryRow;
        try {
          updated = await tx.category.update({
            where: { id: categoryId },
            data: { ...data, updatedAt: now },
          });
        } catch (error) {
          throw isUniqueViolation(error, "slug") ? categorySlugTaken(slug) : error;
        }
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "CATEGORY_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.category,
          entityId: categoryId,
          previous: categorySnapshot(existing),
          next: categorySnapshot(updated),
          correlationId,
          createdAt: now,
        });
        const depth = parentId === null ? 1 : tree.depth(parentId) + 1;
        return { view: toCategoryView(updated, depth, productCount), changed: true };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("category updated", { categoryId, actorEmployeeId: actor.employeeId });
    }
    return view;
  }

  return {
    createBrand,
    listBrands,
    updateBrand,
    createCategory,
    listCategories,
    updateCategory,
  };
}

export type TaxonomyService = ReturnType<typeof createTaxonomyService>;

let defaultService: TaxonomyService | undefined;

export function getTaxonomyService(): TaxonomyService {
  defaultService ??= createTaxonomyService({ db: getDb(), clock: systemClock });
  return defaultService;
}
