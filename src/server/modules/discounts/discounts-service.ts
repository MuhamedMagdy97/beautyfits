import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import {
  withSubcategories,
  type DiscountProblem,
  type DiscountRule,
  type DiscountUsageCounts,
} from "@/server/modules/discounts/engine";
import type {
  CreateDiscountInput,
  ListDiscountsQuery,
  UpdateDiscountInput,
} from "@/server/modules/discounts/schemas";
import { toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Discounts (TASK-026, DB design §14, API §23, Business Spec Q125,
 * Q131–Q138, R36, ADR-0032).
 *
 * - Percentage only (Q131), store-wide or targeted at products, categories
 *   (with their subcategories) and brands (Q132).
 * - Created `INACTIVE`; activated and deactivated explicitly, never deleted.
 *   Editable at any time: orders keep a snapshot (DB design v1.2).
 * - Uses are counted from order creation and given back when the order is
 *   cancelled or expires before shipping (R36): `recordDiscountUsage` and
 *   `releaseDiscountUsage` run inside the checkout / cancellation
 *   transactions (TASK-029, TASK-033).
 * - Every change writes an audit entry.
 */

export interface DiscountActor {
  employeeId: string;
}

const WITH_TARGETS = { products: true, categories: true, brands: true } as const;

type DiscountRow = Prisma.DiscountGetPayload<{ include: typeof WITH_TARGETS }>;

export interface DiscountView {
  id: string;
  code: string | null;
  nameAr: string;
  nameEn: string;
  type: "PERCENTAGE";
  value: number;
  scope: "STORE_WIDE" | "TARGETED";
  productIds: string[];
  categoryIds: string[];
  brandIds: string[];
  maxDiscountAmount: number | null;
  minimumOrderTotal: number | null;
  startsAt: string;
  endsAt: string | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  status: "ACTIVE" | "INACTIVE";
  usedCount: number;
  createdAt: string;
  updatedAt: string;
}

function money(value: bigint | null): number | null {
  return value === null ? null : toJsonNumber(value);
}

/** What an audit entry records (no ids of the links' rows, just the targets). */
function snapshot(row: DiscountRow) {
  return {
    code: row.code,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    value: row.value,
    scope: row.scope,
    productIds: row.products.map((t) => t.productId).sort(),
    categoryIds: row.categories.map((t) => t.categoryId).sort(),
    brandIds: row.brands.map((t) => t.brandId).sort(),
    maxDiscountAmount: money(row.maxDiscountAmount),
    minimumOrderTotal: money(row.minimumOrderTotal),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    usageLimitTotal: row.usageLimitTotal,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
    status: row.status,
  };
}

function toView(row: DiscountRow, usedCount: number): DiscountView {
  return {
    id: row.id,
    ...snapshot(row),
    type: row.discountType,
    usedCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function discountNotFound(): AppError {
  return new AppError("NOT_FOUND", "Discount not found.");
}

/** Uses not given back, per discount. */
async function usedCounts(db: Db, discountIds: string[]): Promise<Map<string, number>> {
  const groups = await db.discountUsage.groupBy({
    by: ["discountId"],
    where: { discountId: { in: discountIds }, releasedAt: null },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.discountId, g._count._all]));
}

/** Total and per-customer uses (not given back) of each discount (R36). */
export async function discountUsageCounts(
  db: Db,
  discountIds: string[],
  customerId: string | null,
): Promise<Map<string, DiscountUsageCounts>> {
  const totals = await usedCounts(db, discountIds);
  const mine = customerId
    ? await db.discountUsage.groupBy({
        by: ["discountId"],
        where: { discountId: { in: discountIds }, customerId, releasedAt: null },
        _count: { _all: true },
      })
    : [];
  const mineById = new Map(mine.map((g) => [g.discountId, g._count._all]));
  return new Map(
    discountIds.map((id) => [
      id,
      { total: totals.get(id) ?? 0, customer: customerId ? (mineById.get(id) ?? 0) : null },
    ]),
  );
}

export interface LoadedDiscount {
  id: string;
  code: string | null;
  nameAr: string;
  nameEn: string;
  value: number;
  maxDiscountAmount: bigint | null;
  minimumOrderTotal: bigint | null;
  endsAt: Date | null;
  rule: DiscountRule;
}

/** Discounts with their targets as engine rules (categories expanded, R36). */
export async function loadDiscounts(
  db: Db,
  where: Prisma.DiscountWhereInput,
): Promise<LoadedDiscount[]> {
  const rows = await db.discount.findMany({
    where,
    include: WITH_TARGETS,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const tree = rows.some((r) => r.categories.length > 0)
    ? await db.category.findMany({ select: { id: true, parentId: true } })
    : [];
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    value: row.value,
    maxDiscountAmount: row.maxDiscountAmount,
    minimumOrderTotal: row.minimumOrderTotal,
    endsAt: row.endsAt,
    rule: {
      status: row.status,
      value: row.value,
      scope: row.scope,
      maxDiscountAmount: row.maxDiscountAmount,
      minimumOrderTotal: row.minimumOrderTotal,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      usageLimitTotal: row.usageLimitTotal,
      usageLimitPerCustomer: row.usageLimitPerCustomer,
      productIds: new Set(row.products.map((t) => t.productId)),
      categoryIds: withSubcategories(
        row.categories.map((t) => t.categoryId),
        tree,
      ),
      brandIds: new Set(row.brands.map((t) => t.brandId)),
    },
  }));
}

/** The error a shopper gets for a discount that does not apply. */
export function discountRefused(problem: DiscountProblem | "NOT_FOUND"): AppError {
  if (problem === "ENDED") {
    return new AppError("DISCOUNT_EXPIRED", "This discount has ended.", {
      details: { reason: problem },
    });
  }
  return new AppError("DISCOUNT_INVALID", "This discount cannot be used for this cart.", {
    details: { reason: problem },
  });
}

/**
 * Counts one use for an order (R36), inside the checkout transaction. The
 * discount row is locked so concurrent orders cannot pass a limit. The
 * caller has already checked eligibility; this re-checks only the limits.
 */
export async function recordDiscountUsage(
  tx: Db,
  input: {
    discountId: string;
    orderId: string;
    customerId: string | null;
    discountAmount: bigint;
    now: Date;
  },
): Promise<void> {
  const locked = await tx.$queryRaw<
    { usage_limit_total: number | null; usage_limit_per_customer: number | null }[]
  >`SELECT usage_limit_total, usage_limit_per_customer FROM discounts
    WHERE id = ${input.discountId}::uuid FOR UPDATE`;
  if (locked.length === 0) {
    throw discountRefused("NOT_FOUND");
  }
  const [{ usage_limit_total: total, usage_limit_per_customer: perCustomer }] = locked;
  const counts = (await discountUsageCounts(tx, [input.discountId], input.customerId)).get(
    input.discountId,
  )!;
  if (total !== null && counts.total >= total) {
    throw discountRefused("USAGE_LIMIT_REACHED");
  }
  if (perCustomer !== null) {
    if (counts.customer === null) throw discountRefused("SIGN_IN_REQUIRED");
    if (counts.customer >= perCustomer) throw discountRefused("CUSTOMER_LIMIT_REACHED");
  }
  await tx.discountUsage.create({
    data: {
      discountId: input.discountId,
      orderId: input.orderId,
      customerId: input.customerId,
      discountAmount: input.discountAmount,
      usedAt: input.now,
    },
  });
}

/** Gives an order's use back (cancelled or expired before shipping, R36). Idempotent. */
export async function releaseDiscountUsage(tx: Db, orderId: string, now: Date): Promise<void> {
  await tx.discountUsage.updateMany({
    where: { orderId, releasedAt: null },
    data: { releasedAt: now },
  });
}

interface DiscountState {
  scope: "STORE_WIDE" | "TARGETED";
  productIds: string[];
  categoryIds: string[];
  brandIds: string[];
  startsAt: Date;
  endsAt: Date | null;
}

/** Cross-field rules and target existence, on the state after the change. */
async function assertValidState(tx: Db, state: DiscountState): Promise<void> {
  const targetCount = state.productIds.length + state.categoryIds.length + state.brandIds.length;
  if (state.scope === "STORE_WIDE" && targetCount > 0) {
    throw validationError("scope", "targets_not_allowed", "A store-wide discount has no targets.");
  }
  if (state.scope === "TARGETED" && targetCount === 0) {
    throw validationError(
      "scope",
      "targets_required",
      "Choose at least one product, category or brand.",
    );
  }
  if (state.endsAt !== null && state.endsAt <= state.startsAt) {
    throw validationError("endsAt", "before_start", "The end must be after the start.");
  }
  const checks = [
    [
      "productIds",
      state.productIds,
      (list: string[]) => tx.product.count({ where: { id: { in: list } } }),
    ],
    [
      "categoryIds",
      state.categoryIds,
      (list: string[]) => tx.category.count({ where: { id: { in: list } } }),
    ],
    [
      "brandIds",
      state.brandIds,
      (list: string[]) => tx.brand.count({ where: { id: { in: list } } }),
    ],
  ] as const;
  for (const [path, list, count] of checks) {
    const unique = [...new Set(list)];
    if (unique.length > 0 && (await count(unique)) !== unique.length) {
      throw validationError(path, "not_found", "One or more ids do not exist.");
    }
  }
}

function targetsData(state: Pick<DiscountState, "productIds" | "categoryIds" | "brandIds">) {
  return {
    products: { create: [...new Set(state.productIds)].map((productId) => ({ productId })) },
    categories: { create: [...new Set(state.categoryIds)].map((categoryId) => ({ categoryId })) },
    brands: { create: [...new Set(state.brandIds)].map((brandId) => ({ brandId })) },
  };
}

function codeTaken(error: unknown): AppError | null {
  return isUniqueViolation(error, "code")
    ? conflict("Another discount already uses this code.", { reason: "CODE_TAKEN" })
    : null;
}

export function createDiscountsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function viewOf(tx: Db, row: DiscountRow): Promise<DiscountView> {
    return toView(row, (await usedCounts(tx, [row.id])).get(row.id) ?? 0);
  }

  async function createDiscount(
    actor: DiscountActor,
    input: CreateDiscountInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<DiscountView> {
    const now = clock.now();
    const view = await runInTransaction(
      async (tx) => {
        await assertValidState(tx, input);
        const { productIds, categoryIds, brandIds, ...fields } = input;
        const row = await tx.discount
          .create({
            data: {
              ...fields,
              status: "INACTIVE",
              createdByEmployeeId: actor.employeeId,
              createdAt: now,
              updatedAt: now,
              ...targetsData({ productIds, categoryIds, brandIds }),
            },
            include: WITH_TARGETS,
          })
          .catch((error: unknown) => {
            throw codeTaken(error) ?? error;
          });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "DISCOUNT_CREATED",
          entityType: AUDIT_ENTITY_TYPES.discount,
          entityId: row.id,
          next: snapshot(row),
          correlationId,
          createdAt: now,
        });
        return toView(row, 0);
      },
      {},
      db,
    );
    logger.info("discount created", { discountId: view.id, actorEmployeeId: actor.employeeId });
    return view;
  }

  async function listDiscounts(
    query: ListDiscountsQuery,
  ): Promise<{ items: DiscountView[]; pagination: Pagination }> {
    const search = query.search;
    const where: Prisma.DiscountWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { nameAr: { contains: search, mode: "insensitive" } },
              { nameEn: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      db.discount.count({ where }),
      db.discount.findMany({
        where,
        include: WITH_TARGETS,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const counts = await usedCounts(
      db,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((row) => toView(row, counts.get(row.id) ?? 0)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async function lockDiscount(tx: Db, discountId: string): Promise<DiscountRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM discounts WHERE id = ${discountId}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw discountNotFound();
    }
    return tx.discount.findUniqueOrThrow({ where: { id: discountId }, include: WITH_TARGETS });
  }

  async function updateDiscount(
    actor: DiscountActor,
    discountId: string,
    input: UpdateDiscountInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<DiscountView> {
    const now = clock.now();
    const view = await runInTransaction(
      async (tx) => {
        const existing = await lockDiscount(tx, discountId);
        const before = snapshot(existing);
        const { productIds, categoryIds, brandIds, ...fields } = input;
        const state: DiscountState = {
          scope: fields.scope ?? existing.scope,
          productIds: productIds ?? before.productIds,
          categoryIds: categoryIds ?? before.categoryIds,
          brandIds: brandIds ?? before.brandIds,
          startsAt: fields.startsAt ?? existing.startsAt,
          endsAt: fields.endsAt === undefined ? existing.endsAt : fields.endsAt,
        };
        await assertValidState(tx, state);
        const replace = <T>(given: unknown, ops: T) => (given === undefined ? {} : ops);
        const updated = await tx.discount
          .update({
            where: { id: discountId },
            data: {
              ...fields,
              updatedAt: now,
              ...replace(productIds, {
                products: { deleteMany: {}, ...targetsData(state).products },
              }),
              ...replace(categoryIds, {
                categories: { deleteMany: {}, ...targetsData(state).categories },
              }),
              ...replace(brandIds, { brands: { deleteMany: {}, ...targetsData(state).brands } }),
            },
            include: WITH_TARGETS,
          })
          .catch((error: unknown) => {
            throw codeTaken(error) ?? error;
          });
        const after = snapshot(updated);
        if (JSON.stringify(after) !== JSON.stringify(before)) {
          await recordAudit(tx, {
            actor: employeeActor(actor.employeeId),
            action: "DISCOUNT_UPDATED",
            entityType: AUDIT_ENTITY_TYPES.discount,
            entityId: discountId,
            previous: before,
            next: after,
            correlationId,
            createdAt: now,
          });
        }
        return viewOf(tx, updated);
      },
      {},
      db,
    );
    logger.info("discount updated", { discountId, actorEmployeeId: actor.employeeId });
    return view;
  }

  /** Activates or deactivates; doing it again changes nothing. */
  async function setDiscountStatus(
    actor: DiscountActor,
    discountId: string,
    status: "ACTIVE" | "INACTIVE",
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<DiscountView> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        const existing = await lockDiscount(tx, discountId);
        if (existing.status === status) {
          return viewOf(tx, existing);
        }
        const updated = await tx.discount.update({
          where: { id: discountId },
          data: { status, updatedAt: now },
          include: WITH_TARGETS,
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: status === "ACTIVE" ? "DISCOUNT_ACTIVATED" : "DISCOUNT_DEACTIVATED",
          entityType: AUDIT_ENTITY_TYPES.discount,
          entityId: discountId,
          previous: { status: existing.status },
          next: { status },
          correlationId,
          createdAt: now,
        });
        logger.info("discount status changed", { discountId, status });
        return viewOf(tx, updated);
      },
      {},
      db,
    );
  }

  return { createDiscount, listDiscounts, updateDiscount, setDiscountStatus };
}

export type DiscountsService = ReturnType<typeof createDiscountsService>;

let defaultService: DiscountsService | undefined;

export function getDiscountsService(): DiscountsService {
  defaultService ??= createDiscountsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
