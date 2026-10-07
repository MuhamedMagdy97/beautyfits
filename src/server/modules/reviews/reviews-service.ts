import type { Prisma, PrismaClient, ReviewStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  type AuditActor,
} from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation } from "@/server/modules/catalog/errors";
import type {
  CreateReviewInput,
  ListReviewsQuery,
  UpdateReviewInput,
} from "@/server/modules/reviews/schemas";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Verified reviews (TASK-044, Business Spec Q3, Q11, Q12, Q49, Q50,
 * Q171–Q174, C6; User Flows §5; API §20; ADR-0042).
 *
 * - Only the customer of a delivered order may review a product of it, once
 *   per order and product (Q12, Q49); a later delivered order may review
 *   the same product again.
 * - Reviews publish immediately after the automated checks (Q11, Q173);
 *   edits are checked the same way and need no approval (Q50). A hidden
 *   review stays hidden when edited.
 * - Moderators hide and restore with `REVIEW_MODERATE`; every change keeps a
 *   history row and an audit entry, nothing is deleted (Q174).
 * - Public listings are product-level (C6) and never name the customer.
 */

/** The order status that makes a purchase "successful" (Q12; TASK-034 reaches it). */
export const REVIEWABLE_ORDER_STATUS = "DELIVERED" as const;

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

/** A review as its author sees it. */
export interface MyReviewView {
  id: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  variantId: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

/** One published review of `GET /products/{productId}/reviews`. */
export interface PublicReviewView {
  id: string;
  rating: number;
  body: string;
  /** The purchased variant's name at order time, if it had one. */
  variantName: string | null;
  verifiedPurchase: true;
  createdAt: string;
  updatedAt: string;
}

export interface AdminReviewView extends MyReviewView {
  customerId: string;
  orderNumber: string;
  sku: string;
  productName: Prisma.JsonValue;
  variantName: Prisma.JsonValue;
  moderationReason: string | null;
  openReportCount: number;
  reports: {
    id: string;
    customerId: string;
    reason: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }[];
  moderationHistory: {
    fromStatus: ReviewStatus;
    toStatus: ReviewStatus;
    employeeId: string;
    reason: string | null;
    createdAt: string;
  }[];
}

const ADMIN_INCLUDE = {
  order: { select: { orderNumber: true } },
  orderItem: {
    select: {
      productVariantId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
    },
  },
  reports: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  moderationHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.ReviewInclude;

type AdminRow = Prisma.ReviewGetPayload<{ include: typeof ADMIN_INCLUDE }>;
type MyRow = Prisma.ReviewGetPayload<{
  include: { orderItem: { select: { productVariantId: true } } };
}>;

function toMyView(review: MyRow): MyReviewView {
  return {
    id: review.id,
    orderId: review.orderId,
    orderItemId: review.orderItemId,
    productId: review.productId,
    variantId: review.orderItem.productVariantId,
    rating: review.rating,
    body: review.body,
    status: review.status,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

function toAdminView(review: AdminRow): AdminReviewView {
  return {
    ...toMyView(review),
    customerId: review.customerId,
    orderNumber: review.order.orderNumber,
    sku: review.orderItem.skuSnapshot,
    productName: review.orderItem.productNameSnapshot,
    variantName: review.orderItem.variantNameSnapshot,
    moderationReason: review.moderationReason,
    openReportCount: review.reports.filter((r) => r.resolvedAt === null).length,
    reports: review.reports.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    })),
    moderationHistory: review.moderationHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      employeeId: h.employeeId,
      reason: h.reason,
      createdAt: h.createdAt.toISOString(),
    })),
  };
}

function reviewNotFound(): AppError {
  return new AppError("NOT_FOUND", "Review not found.");
}

function customerActor(customerId: string): AuditActor {
  return { type: "CUSTOMER", id: customerId };
}

function pagination(query: { page: number; pageSize: number }, total: number): Pagination {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

const ORDER_ITEM = { orderItem: { select: { productVariantId: true } } } as const;

export function createReviewsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  /** `POST /orders/{orderId}/items/{orderItemId}/review`. */
  async function createReview(
    customerId: string,
    orderId: string,
    orderItemId: string,
    input: CreateReviewInput,
    ctx: Ctx,
  ): Promise<MyReviewView> {
    const now = clock.now();
    // Another customer's order, a guest order or a foreign item: 404, so ids reveal nothing.
    const item = await db.orderItem.findFirst({
      where: { id: orderItemId, orderId, order: { customerId } },
      select: { productId: true, order: { select: { status: true } } },
    });
    if (!item) {
      throw new AppError("NOT_FOUND", "Order item not found.");
    }
    if (item.order.status !== REVIEWABLE_ORDER_STATUS) {
      throw new AppError("ORDER_STATE_INVALID", "Only delivered orders can be reviewed.", {
        details: { status: item.order.status, required: REVIEWABLE_ORDER_STATUS },
      });
    }

    let review: MyRow;
    try {
      review = await runInTransaction(
        async (tx) => {
          const created = await tx.review.create({
            data: {
              customerId,
              productId: item.productId,
              orderId,
              orderItemId,
              rating: input.rating,
              body: input.body,
              status: "PUBLISHED",
              createdAt: now,
              updatedAt: now,
            },
            include: ORDER_ITEM,
          });
          await recordAudit(tx, {
            actor: customerActor(customerId),
            action: "REVIEW_CREATED",
            entityType: AUDIT_ENTITY_TYPES.review,
            entityId: created.id,
            next: { orderId, productId: item.productId, rating: input.rating, body: input.body },
            correlationId: ctx.correlationId,
            createdAt: now,
          });
          return created;
        },
        {},
        db,
      );
    } catch (error) {
      if (isUniqueViolation(error, "order_id")) {
        const existing = await db.review.findUniqueOrThrow({
          where: { orderId_productId: { orderId, productId: item.productId } },
          select: { id: true },
        });
        throw conflict("This order already has a review of this product.", {
          reviewId: existing.id,
        });
      }
      throw error;
    }
    ctx.logger.info("review created", { reviewId: review.id });
    return toMyView(review);
  }

  /** `PATCH /reviews/{reviewId}`: the author only; re-checked like a new review (Q50). */
  async function updateReview(
    customerId: string,
    reviewId: string,
    input: UpdateReviewInput,
    ctx: Ctx,
  ): Promise<MyReviewView> {
    const now = clock.now();
    const review = await runInTransaction(
      async (tx) => {
        const current = await lockReview(tx, reviewId);
        if (!current || current.customerId !== customerId) {
          throw reviewNotFound();
        }
        const updated = await tx.review.update({
          where: { id: reviewId },
          data: { rating: input.rating, body: input.body, updatedAt: now },
          include: ORDER_ITEM,
        });
        await recordAudit(tx, {
          actor: customerActor(customerId),
          action: "REVIEW_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.review,
          entityId: reviewId,
          previous: { rating: current.rating, body: current.body },
          next: { rating: updated.rating, body: updated.body },
          correlationId: ctx.correlationId,
          createdAt: now,
        });
        return updated;
      },
      {},
      db,
    );
    ctx.logger.info("review updated", { reviewId });
    return toMyView(review);
  }

  /** `POST /reviews/{reviewId}/report`: once per customer; repeating answers the same. */
  async function reportReview(
    customerId: string,
    reviewId: string,
    reason: string | undefined,
    ctx: Ctx,
  ): Promise<{ reviewId: string }> {
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        const review = await tx.review.findUnique({
          where: { id: reviewId },
          select: { status: true },
        });
        // Hidden reviews are not public, so they cannot be reported.
        if (!review || review.status !== "PUBLISHED") {
          throw reviewNotFound();
        }
        const { count } = await tx.reviewReport.createMany({
          data: [{ reviewId, customerId, reason: reason ?? null, createdAt: now }],
          skipDuplicates: true,
        });
        if (count === 1) {
          await recordAudit(tx, {
            actor: customerActor(customerId),
            action: "REVIEW_REPORTED",
            entityType: AUDIT_ENTITY_TYPES.review,
            entityId: reviewId,
            reason: reason ?? null,
            correlationId: ctx.correlationId,
            createdAt: now,
          });
        }
      },
      {},
      db,
    );
    ctx.logger.info("review reported", { reviewId });
    return { reviewId };
  }

  /** `GET /products/{productId}/reviews`: published reviews of a published product. */
  async function listProductReviews(
    productId: string,
    query: { page: number; pageSize: number },
    locale: SupportedLocale,
  ): Promise<{
    summary: { reviewCount: number; averageRating: number | null };
    items: PublicReviewView[];
    pagination: Pagination;
  }> {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { status: true },
    });
    if (!product || product.status !== "PUBLISHED") {
      throw new AppError("NOT_FOUND", "Product not found.");
    }
    const where: Prisma.ReviewWhereInput = { productId, status: "PUBLISHED" };
    const [stats, rows] = await Promise.all([
      db.review.aggregate({ where, _count: { _all: true }, _avg: { rating: true } }),
      db.review.findMany({
        where,
        include: { orderItem: { select: { variantNameSnapshot: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const average = stats._avg.rating;
    return {
      summary: {
        reviewCount: stats._count._all,
        averageRating: average === null ? null : Math.round(average * 10) / 10,
      },
      items: rows.map((row) => {
        const names = row.orderItem.variantNameSnapshot as Record<string, string | null> | null;
        return {
          id: row.id,
          rating: row.rating,
          body: row.body,
          variantName: names?.[locale] ?? null,
          verifiedPurchase: true,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      pagination: pagination(query, stats._count._all),
    };
  }

  /** `GET /admin/reviews`: all reviews, newest first, hidden and reported included. */
  async function listReviews(
    query: ListReviewsQuery,
  ): Promise<{ items: AdminReviewView[]; pagination: Pagination }> {
    const where: Prisma.ReviewWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.reported === true ? { reports: { some: { resolvedAt: null } } } : {}),
      ...(query.reported === false ? { reports: { none: { resolvedAt: null } } } : {}),
    };
    const [total, rows] = await Promise.all([
      db.review.count({ where }),
      db.review.findMany({
        where,
        include: ADMIN_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toAdminView), pagination: pagination(query, total) };
  }

  async function moderate(
    employeeId: string,
    reviewId: string,
    to: ReviewStatus,
    reason: string | null,
    ctx: Ctx,
  ): Promise<AdminReviewView> {
    const from: ReviewStatus = to === "HIDDEN" ? "PUBLISHED" : "HIDDEN";
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        const current = await lockReview(tx, reviewId);
        if (!current) {
          throw reviewNotFound();
        }
        if (current.status !== from) {
          throw conflict(`The review is already ${current.status}.`, { status: current.status });
        }
        // `updatedAt` tracks the author's edits only.
        await tx.review.update({
          where: { id: reviewId },
          data: { status: to, moderationReason: to === "HIDDEN" ? reason : null },
        });
        await tx.reviewModerationEvent.create({
          data: { reviewId, fromStatus: from, toStatus: to, employeeId, reason, createdAt: now },
        });
        if (to === "HIDDEN") {
          // Hiding handles the open reports.
          await tx.reviewReport.updateMany({
            where: { reviewId, resolvedAt: null },
            data: { resolvedAt: now },
          });
        }
        await recordAudit(tx, {
          actor: employeeActor(employeeId),
          action: to === "HIDDEN" ? "REVIEW_HIDDEN" : "REVIEW_RESTORED",
          entityType: AUDIT_ENTITY_TYPES.review,
          entityId: reviewId,
          previous: { status: from },
          next: { status: to },
          reason,
          correlationId: ctx.correlationId,
          createdAt: now,
        });
      },
      {},
      db,
    );
    ctx.logger.info("review moderated", { reviewId, status: to });
    return toAdminView(
      await db.review.findUniqueOrThrow({ where: { id: reviewId }, include: ADMIN_INCLUDE }),
    );
  }

  return {
    createReview,
    updateReview,
    reportReview,
    listProductReviews,
    listReviews,
    /** `POST /admin/reviews/{reviewId}/hide` (`REVIEW_MODERATE`). */
    hideReview: (employeeId: string, reviewId: string, reason: string, ctx: Ctx) =>
      moderate(employeeId, reviewId, "HIDDEN", reason, ctx),
    /** `POST /admin/reviews/{reviewId}/restore` (`REVIEW_MODERATE`). */
    restoreReview: (employeeId: string, reviewId: string, reason: string | undefined, ctx: Ctx) =>
      moderate(employeeId, reviewId, "PUBLISHED", reason ?? null, ctx),
  };
}

/** Locks the review row for an edit or a moderation change. */
async function lockReview(
  tx: Db,
  reviewId: string,
): Promise<{ customerId: string; status: ReviewStatus; rating: number; body: string } | null> {
  const rows = await tx.$queryRaw<
    { customer_id: string; status: ReviewStatus; rating: number; body: string }[]
  >`SELECT customer_id, status, rating, body FROM reviews WHERE id = ${reviewId}::uuid FOR UPDATE`;
  const row = rows[0];
  return row
    ? { customerId: row.customer_id, status: row.status, rating: row.rating, body: row.body }
    : null;
}

export type ReviewsService = ReturnType<typeof createReviewsService>;

let defaultService: ReviewsService | undefined;

export function getReviewsService(): ReviewsService {
  defaultService ??= createReviewsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
