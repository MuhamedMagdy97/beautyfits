import type { Prisma, PrismaClient, ReturnStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  type AuditAction,
  type AuditActor,
} from "@/server/modules/audit/audit";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import {
  CUSTOMER_UPLOAD_PURPOSE,
  lockAttachableAsset,
  mediaContentUrl,
} from "@/server/modules/media/uploads-service";
import {
  checkInspection,
  checkReturnQuantities,
  RELEASED_RETURN_STATUSES,
  requiredStatusFor,
  restockQuantity,
  returnWindowEndsAt,
} from "@/server/modules/returns/returns";
import {
  MAX_RETURN_EVIDENCE,
  type ApproveReturnInput,
  type CreateReturnInput,
  type InspectReturnItemInput,
  type RejectReturnInput,
  type ReturnStepInput,
  type RequestReturnPickupInput,
  type ListReturnsQuery,
} from "@/server/modules/returns/schemas";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Customer return requests (TASK-037, ADR-0049; Business Spec Q5, Q14, Q17,
 * Q34, Q90–Q92, Q99, Q100, R21; User Flows §11; API §17).
 *
 * - A return is its own lifecycle: the order stays `DELIVERED` (Q90).
 * - The customer of a delivered order asks within the return window (R21)
 *   for some or all of its lines (Q34), with a free-text reason (Q14) and,
 *   for damaged or wrong items, at least one photo (Q100).
 * - The request waits in `PENDING_APPROVAL` for staff (Q91, TASK-038). The
 *   customer may add photos or withdraw it until then.
 * - A rejected request is never rewritten; the customer submits a new one
 *   (Q92), linked to the rejected one when sent through `resubmit`.
 * - Staff approve or reject a waiting request (`APPROVE_RETURN`, Q91, R18),
 *   then ask a carrier to collect the parcel (`MANAGE_RETURNS`, Q93;
 *   TASK-038, ADR-0056). Every status change is kept in
 *   `return_status_history`.
 * - Warehouse staff receive the parcel, inspect it and record each line's
 *   outcomes; sellable units are restocked at once (TASK-039, ADR-0060).
 */

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

export interface ReturnView {
  id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  status: string;
  claimType: string;
  reason: string;
  resubmittedFromReturnId: string | null;
  items: {
    id: string;
    orderItemId: string;
    productId: string;
    variantId: string;
    sku: string;
    productName: Prisma.JsonValue;
    variantName: Prisma.JsonValue;
    orderedQuantity: number;
    requestedQuantity: number;
  }[];
  evidence: { mediaAssetId: string; url: string; createdAt: string }[];
  cancelledAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  pickup: {
    shippingCompany: { id: string; code: string; name: string };
    trackingNumber: string | null;
    feePayer: string;
    requestedAt: string;
  } | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A line's inspection (TASK-039): staff only. */
export interface ReturnItemInspectionView {
  inspectedAt: string;
  inspectedByEmployeeId: string;
  outcomes: { result: string; condition: string; quantity: number; notes: string | null }[];
  evidence: { mediaAssetId: string; url: string }[];
}

export interface AdminReturnView extends Omit<ReturnView, "items"> {
  items: (ReturnView["items"][number] & { inspection: ReturnItemInspectionView | null })[];
  customerId: string | null;
  approvedByEmployeeId: string | null;
  statusHistory: {
    fromStatus: string | null;
    toStatus: string;
    changedByType: string;
    changedById: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}

const RETURN_INCLUDE = {
  order: { select: { orderNumber: true } },
  items: {
    include: {
      orderItem: {
        select: {
          productId: true,
          productVariantId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          variantNameSnapshot: true,
          quantity: true,
        },
      },
      inspections: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      inspectionEvidence: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  evidence: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  pickupShippingCompany: { select: { id: true, code: true, name: true } },
  statusHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.ReturnInclude;

type ReturnRow = Prisma.ReturnGetPayload<{ include: typeof RETURN_INCLUDE }>;

function toView(row: ReturnRow): ReturnView {
  return {
    id: row.id,
    returnNumber: row.returnNumber,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    status: row.status,
    claimType: row.claimType,
    reason: row.customerReasonText,
    resubmittedFromReturnId: row.resubmittedFromId,
    items: row.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      productId: item.orderItem.productId,
      variantId: item.orderItem.productVariantId,
      sku: item.orderItem.skuSnapshot,
      productName: item.orderItem.productNameSnapshot,
      variantName: item.orderItem.variantNameSnapshot,
      orderedQuantity: item.orderItem.quantity,
      requestedQuantity: item.requestedQuantity,
    })),
    evidence: row.evidence.map((e) => ({
      mediaAssetId: e.mediaAssetId,
      url: mediaContentUrl(e.mediaAssetId),
      createdAt: e.createdAt.toISOString(),
    })),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    pickup:
      row.pickupShippingCompany && row.pickupFeePayer && row.pickupRequestedAt
        ? {
            shippingCompany: row.pickupShippingCompany,
            trackingNumber: row.pickupTrackingNumber,
            feePayer: row.pickupFeePayer,
            requestedAt: row.pickupRequestedAt.toISOString(),
          }
        : null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toInspectionView(item: ReturnRow["items"][number]): ReturnItemInspectionView | null {
  const first = item.inspections[0];
  if (!first) {
    return null;
  }
  return {
    inspectedAt: first.createdAt.toISOString(),
    inspectedByEmployeeId: first.inspectedByEmployeeId,
    outcomes: item.inspections.map((o) => ({
      result: o.result,
      condition: o.condition,
      quantity: o.quantity,
      notes: o.notes,
    })),
    evidence: item.inspectionEvidence.map((e) => ({
      mediaAssetId: e.mediaAssetId,
      url: mediaContentUrl(e.mediaAssetId),
    })),
  };
}

function toAdminView(row: ReturnRow): AdminReturnView {
  const view = toView(row);
  return {
    ...view,
    items: view.items.map((item, index) => ({
      ...item,
      inspection: toInspectionView(row.items[index]),
    })),
    customerId: row.customerId,
    approvedByEmployeeId: row.approvedById,
    statusHistory: row.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedByType: h.changedByType,
      changedById: h.changedById,
      reason: h.reason,
      createdAt: h.createdAt.toISOString(),
    })),
  };
}

function returnNotFound(): AppError {
  return new AppError("NOT_FOUND", "Return not found.");
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

/** Locks a return row; null when unknown. */
async function lockReturn(
  tx: Db,
  returnId: string,
): Promise<{ customerId: string | null; status: ReturnStatus; orderId: string } | null> {
  const rows = await tx.$queryRaw<
    { customer_id: string | null; status: ReturnStatus; order_id: string }[]
  >`
    SELECT customer_id, status::text, order_id FROM returns WHERE id = ${returnId}::uuid FOR UPDATE`;
  const row = rows[0];
  return row ? { customerId: row.customer_id, status: row.status, orderId: row.order_id } : null;
}

/** Refuses a status move the return's current status does not allow. */
function requireTransition(status: ReturnStatus, to: ReturnStatus): void {
  const required = requiredStatusFor(status, to);
  if (required) {
    throw new AppError("RETURN_STATE_INVALID", "The return cannot make this move now.", {
      details: { status, required },
    });
  }
}

function requirePending(status: string): void {
  if (status !== "PENDING_APPROVAL") {
    throw new AppError("RETURN_STATE_INVALID", "The return is no longer waiting for approval.", {
      details: { status, required: "PENDING_APPROVAL" },
    });
  }
}

/**
 * Checks photos about to be attached: the customer's own checked
 * (`SAFE`) return-evidence uploads, not attached anywhere yet. `FOR SHARE`
 * keeps them unchanged until the transaction ends.
 */
async function lockEvidence(
  tx: Db,
  customerId: string,
  ids: readonly string[],
  field: string,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const rows = await tx.$queryRaw<
    { id: string; purpose: string; scan_status: string; created_by_customer_id: string | null }[]
  >`SELECT id, purpose::text, scan_status::text, created_by_customer_id FROM media_assets
    WHERE id = ANY(${ids}::uuid[]) FOR SHARE`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [index, id] of ids.entries()) {
    const row = byId.get(id);
    if (
      !row ||
      row.purpose !== CUSTOMER_UPLOAD_PURPOSE ||
      row.created_by_customer_id !== customerId
    ) {
      throw validationError(
        `${field}.${index}`,
        "media_asset_not_found",
        "No uploaded photo of yours has this id.",
      );
    }
    if (row.scan_status !== "SAFE") {
      throw conflict("This file has not passed the upload checks.", {
        reason: "MEDIA_NOT_READY",
        mediaAssetId: id,
        scanStatus: row.scan_status,
      });
    }
  }
  const attached = await tx.returnEvidence.findFirst({
    where: { mediaAssetId: { in: [...ids] } },
    select: { mediaAssetId: true },
  });
  if (attached) {
    throw conflict("This photo is already attached to a return.", {
      reason: "MEDIA_ALREADY_ATTACHED",
      mediaAssetId: attached.mediaAssetId,
    });
  }
}

export function createReturnsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function load(returnId: string): Promise<ReturnRow> {
    return db.return.findUniqueOrThrow({ where: { id: returnId }, include: RETURN_INCLUDE });
  }

  async function createInTx(
    tx: Db,
    customerId: string,
    orderId: string,
    input: CreateReturnInput,
    resubmittedFromId: string | null,
    now: Date,
    ctx: Ctx,
  ): Promise<string> {
    // The order row lock serializes requests of one order, so two requests
    // can never claim the same units.
    const orders = await tx.$queryRaw<
      { customer_id: string | null; status: string; delivered_at: Date | null }[]
    >`SELECT customer_id, status::text, delivered_at FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = orders[0];
    // Another customer's order or a guest order: 404, so ids reveal nothing.
    if (!order || order.customer_id !== customerId) {
      throw new AppError("NOT_FOUND", "Order not found.");
    }
    if (order.status !== "DELIVERED" || order.delivered_at === null) {
      throw new AppError("ORDER_STATE_INVALID", "Only delivered orders can be returned.", {
        details: { status: order.status, required: "DELIVERED" },
      });
    }
    const windowEndsAt = returnWindowEndsAt(order.delivered_at);
    if (now.getTime() >= windowEndsAt.getTime()) {
      throw new AppError("RETURN_WINDOW_EXPIRED", "The return period for this order has ended.", {
        details: {
          deliveredAt: order.delivered_at.toISOString(),
          returnWindowEndsAt: windowEndsAt.toISOString(),
        },
      });
    }

    const orderItems = await tx.orderItem.findMany({
      where: { orderId },
      select: { id: true, quantity: true },
    });
    const claimed = await tx.returnItem.groupBy({
      by: ["orderItemId"],
      where: {
        orderItem: { orderId },
        return: { status: { notIn: [...RELEASED_RETURN_STATUSES] } },
      },
      _sum: { requestedQuantity: true },
    });
    const problem = checkReturnQuantities(
      new Map(orderItems.map((item) => [item.id, item.quantity])),
      new Map(claimed.map((c) => [c.orderItemId, c._sum.requestedQuantity ?? 0])),
      input.items,
    );
    if (problem?.kind === "UNKNOWN_ITEM") {
      throw validationError(
        `items.${problem.index}.orderItemId`,
        "order_item_not_found",
        "This item is not part of the order.",
      );
    }
    if (problem?.kind === "TOO_MANY") {
      throw conflict("More units are asked for than can still be returned.", {
        reason: "RETURN_QUANTITY_EXCEEDED",
        orderItemId: problem.orderItemId,
        requestedQuantity: problem.requested,
        returnableQuantity: problem.returnable,
      });
    }
    await lockEvidence(tx, customerId, input.evidenceMediaAssetIds, "evidenceMediaAssetIds");

    const created = await tx.return.create({
      data: {
        orderId,
        customerId,
        status: "PENDING_APPROVAL",
        claimType: input.claimType,
        customerReasonText: input.reason,
        resubmittedFromId,
        createdAt: now,
        updatedAt: now,
        items: {
          create: input.items.map((item) => ({
            orderItemId: item.orderItemId,
            requestedQuantity: item.quantity,
            createdAt: now,
          })),
        },
        evidence: {
          create: input.evidenceMediaAssetIds.map((mediaAssetId) => ({
            mediaAssetId,
            uploadedByType: "CUSTOMER" as const,
            uploadedById: customerId,
            createdAt: now,
          })),
        },
        statusHistory: {
          create: [
            {
              toStatus: "PENDING_APPROVAL",
              changedByType: "CUSTOMER",
              changedById: customerId,
              createdAt: now,
            },
          ],
        },
      },
      select: { id: true, returnNumber: true },
    });
    await recordAudit(tx, {
      actor: customerActor(customerId),
      action: "RETURN_REQUESTED",
      entityType: AUDIT_ENTITY_TYPES.return,
      entityId: created.id,
      next: {
        returnNumber: created.returnNumber,
        orderId,
        claimType: input.claimType,
        reason: input.reason,
        items: input.items,
        evidenceMediaAssetIds: input.evidenceMediaAssetIds,
        resubmittedFromReturnId: resubmittedFromId,
      },
      correlationId: ctx.correlationId,
      createdAt: now,
    });
    return created.id;
  }

  /** `POST /orders/{orderId}/returns`. */
  async function createReturn(
    customerId: string,
    orderId: string,
    input: CreateReturnInput,
    ctx: Ctx,
  ): Promise<ReturnView> {
    const now = clock.now();
    const id = await runInTransaction(
      (tx) => createInTx(tx, customerId, orderId, input, null, now, ctx),
      {},
      db,
    );
    ctx.logger.info("return requested", { returnId: id, orderId });
    return toView(await load(id));
  }

  /** `POST /returns/{returnId}/resubmit`: a new request after a rejection (Q92). */
  async function resubmitReturn(
    customerId: string,
    returnId: string,
    input: CreateReturnInput,
    ctx: Ctx,
  ): Promise<ReturnView> {
    const now = clock.now();
    const id = await runInTransaction(
      async (tx) => {
        const rejected = await tx.return.findUnique({
          where: { id: returnId },
          select: { customerId: true, status: true, orderId: true },
        });
        if (!rejected || rejected.customerId !== customerId) {
          throw returnNotFound();
        }
        if (rejected.status !== "REJECTED") {
          throw new AppError("RETURN_STATE_INVALID", "Only a rejected return can be resubmitted.", {
            details: { status: rejected.status, required: "REJECTED" },
          });
        }
        return createInTx(tx, customerId, rejected.orderId, input, returnId, now, ctx);
      },
      {},
      db,
    );
    ctx.logger.info("return resubmitted", { returnId: id, resubmittedFromReturnId: returnId });
    return toView(await load(id));
  }

  /** `POST /returns/{returnId}/evidence`: more photos while the request waits (Q100). */
  async function addEvidence(
    customerId: string,
    returnId: string,
    mediaAssetIds: string[],
    ctx: Ctx,
  ): Promise<ReturnView> {
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        const current = await lockReturn(tx, returnId);
        if (!current || current.customerId !== customerId) {
          throw returnNotFound();
        }
        requirePending(current.status);
        const existing = await tx.returnEvidence.count({ where: { returnId } });
        if (existing + mediaAssetIds.length > MAX_RETURN_EVIDENCE) {
          throw validationError(
            "mediaAssetIds",
            "too_many_files",
            `A return can hold at most ${MAX_RETURN_EVIDENCE} photos.`,
          );
        }
        await lockEvidence(tx, customerId, mediaAssetIds, "mediaAssetIds");
        await tx.returnEvidence.createMany({
          data: mediaAssetIds.map((mediaAssetId) => ({
            returnId,
            mediaAssetId,
            uploadedByType: "CUSTOMER" as const,
            uploadedById: customerId,
            createdAt: now,
          })),
        });
        await tx.return.update({ where: { id: returnId }, data: { updatedAt: now } });
        await recordAudit(tx, {
          actor: customerActor(customerId),
          action: "RETURN_EVIDENCE_ADDED",
          entityType: AUDIT_ENTITY_TYPES.return,
          entityId: returnId,
          next: { mediaAssetIds },
          correlationId: ctx.correlationId,
          createdAt: now,
        });
      },
      {},
      db,
    );
    ctx.logger.info("return evidence added", { returnId, count: mediaAssetIds.length });
    return toView(await load(returnId));
  }

  /** `POST /returns/{returnId}/cancel`: the customer withdraws a waiting request. */
  async function cancelReturn(customerId: string, returnId: string, ctx: Ctx): Promise<ReturnView> {
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        const current = await lockReturn(tx, returnId);
        if (!current || current.customerId !== customerId) {
          throw returnNotFound();
        }
        requireTransition(current.status, "CANCELLED");
        await tx.return.update({
          where: { id: returnId },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            updatedAt: now,
            statusHistory: {
              create: [
                {
                  fromStatus: current.status,
                  toStatus: "CANCELLED",
                  changedByType: "CUSTOMER",
                  changedById: customerId,
                  createdAt: now,
                },
              ],
            },
          },
        });
        await recordAudit(tx, {
          actor: customerActor(customerId),
          action: "RETURN_CANCELLED",
          entityType: AUDIT_ENTITY_TYPES.return,
          entityId: returnId,
          previous: { status: current.status },
          next: { status: "CANCELLED" },
          correlationId: ctx.correlationId,
          createdAt: now,
        });
      },
      {},
      db,
    );
    ctx.logger.info("return cancelled", { returnId });
    return toView(await load(returnId));
  }

  /** `GET /returns/{returnId}`: the customer's own return. */
  async function getMyReturn(customerId: string, returnId: string): Promise<ReturnView> {
    const row = await db.return.findUnique({ where: { id: returnId }, include: RETURN_INCLUDE });
    if (!row || row.customerId !== customerId) {
      throw returnNotFound();
    }
    return toView(row);
  }

  async function list(
    where: Prisma.ReturnWhereInput,
    query: { page: number; pageSize: number },
  ): Promise<{ rows: ReturnRow[]; pagination: Pagination }> {
    const [total, rows] = await Promise.all([
      db.return.count({ where }),
      db.return.findMany({
        where,
        include: RETURN_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { rows, pagination: pagination(query, total) };
  }

  /** `GET /me/returns`: newest first. */
  async function listMyReturns(
    customerId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: ReturnView[]; pagination: Pagination }> {
    const page = await list({ customerId }, query);
    return { items: page.rows.map(toView), pagination: page.pagination };
  }

  /** `GET /admin/returns` (`RETURNS_VIEW`): newest first. */
  async function listReturns(
    query: ListReturnsQuery,
  ): Promise<{ items: AdminReturnView[]; pagination: Pagination }> {
    const page = await list(
      {
        ...(query.status ? { status: query.status } : {}),
        ...(query.orderId ? { orderId: query.orderId.toLowerCase() } : {}),
        ...(query.customerId ? { customerId: query.customerId.toLowerCase() } : {}),
      },
      query,
    );
    return { items: page.rows.map(toAdminView), pagination: page.pagination };
  }

  /** `GET /admin/returns/{returnId}` (`RETURNS_VIEW`). */
  async function getReturn(returnId: string): Promise<AdminReturnView> {
    const row = await db.return.findUnique({ where: { id: returnId }, include: RETURN_INCLUDE });
    if (!row) {
      throw returnNotFound();
    }
    return toAdminView(row);
  }

  /**
   * One staff status move under the return row lock: checks the move, runs
   * `apply` (extra checks and columns), then records the status history and
   * the audit entry in the same transaction.
   */
  async function staffTransition(
    employeeId: string,
    returnId: string,
    to: ReturnStatus,
    step: {
      action: AuditAction;
      reason: string | null;
      apply: (
        tx: Db,
        current: { orderId: string; customerId: string | null },
        now: Date,
      ) => Promise<{ data: Prisma.ReturnUpdateInput; audit?: Record<string, unknown> }>;
    },
    ctx: Ctx,
  ): Promise<AdminReturnView> {
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        const current = await lockReturn(tx, returnId);
        if (!current) {
          throw returnNotFound();
        }
        requireTransition(current.status, to);
        const { data, audit } = await step.apply(tx, current, now);
        await tx.return.update({
          where: { id: returnId },
          data: {
            ...data,
            status: to,
            updatedAt: now,
            statusHistory: {
              create: [
                {
                  fromStatus: current.status,
                  toStatus: to,
                  changedByType: "EMPLOYEE",
                  changedById: employeeId,
                  reason: step.reason,
                  createdAt: now,
                },
              ],
            },
          },
        });
        await recordAudit(tx, {
          actor: employeeActor(employeeId),
          action: step.action,
          entityType: AUDIT_ENTITY_TYPES.return,
          entityId: returnId,
          previous: { status: current.status },
          next: { status: to, ...audit },
          reason: step.reason,
          correlationId: ctx.correlationId,
          createdAt: now,
        });
      },
      {},
      db,
    );
    ctx.logger.info("return status changed", { returnId, status: to });
    return getReturn(returnId);
  }

  /** `POST /admin/returns/{returnId}/approve` (`APPROVE_RETURN`, Q91). */
  function approveReturn(
    employeeId: string,
    returnId: string,
    input: ApproveReturnInput,
    ctx: Ctx,
  ): Promise<AdminReturnView> {
    return staffTransition(
      employeeId,
      returnId,
      "APPROVED",
      {
        action: "RETURN_APPROVED",
        reason: input.note ?? null,
        apply: async (tx, current, now) => {
          // After commit, workers may tell the customer (API §31).
          await tx.outboxEvent.create({
            data: {
              eventType: "RETURN_APPROVED",
              aggregateType: "RETURN",
              aggregateId: returnId,
              payload: {
                returnId,
                orderId: current.orderId,
                customerId: current.customerId,
                correlationId: ctx.correlationId,
              },
              availableAt: now,
              createdAt: now,
            },
          });
          return { data: { approvedBy: { connect: { id: employeeId } }, approvedAt: now } };
        },
      },
      ctx,
    );
  }

  /**
   * `POST /admin/returns/{returnId}/reject` (`APPROVE_RETURN`, Q92): final;
   * the customer may submit a new request.
   */
  function rejectReturn(
    employeeId: string,
    returnId: string,
    input: RejectReturnInput,
    ctx: Ctx,
  ): Promise<AdminReturnView> {
    return staffTransition(
      employeeId,
      returnId,
      "REJECTED",
      {
        action: "RETURN_REJECTED",
        reason: input.reason,
        apply: async (_tx, _current, now) => ({
          data: { rejectedAt: now, rejectionReason: input.reason },
        }),
      },
      ctx,
    );
  }

  /**
   * `POST /admin/returns/{returnId}/pickup` (`MANAGE_RETURNS`, Q93): BeautyFits
   * asks an active carrier to collect the parcel from the customer.
   * `feePayer` records who pays that carrier (C2); the final responsibility
   * is assessed after inspection (Q99, TASK-040).
   */
  function requestPickup(
    employeeId: string,
    returnId: string,
    input: RequestReturnPickupInput,
    ctx: Ctx,
  ): Promise<AdminReturnView> {
    return staffTransition(
      employeeId,
      returnId,
      "PICKUP_SCHEDULED",
      {
        action: "RETURN_PICKUP_REQUESTED",
        reason: input.notes ?? null,
        apply: async (tx, _current, now) => {
          const company = await tx.shippingCompany.findUnique({
            where: { id: input.shippingCompanyId },
            select: { status: true },
          });
          if (!company) {
            throw validationError("shippingCompanyId", "not_found", "Unknown shipping company.");
          }
          if (company.status !== "ACTIVE") {
            throw validationError("shippingCompanyId", "inactive", "This company is inactive.");
          }
          const trackingNumber = input.trackingNumber ?? null;
          return {
            data: {
              pickupShippingCompany: { connect: { id: input.shippingCompanyId } },
              pickupTrackingNumber: trackingNumber,
              pickupFeePayer: input.feePayer,
              pickupRequestedAt: now,
            },
            audit: {
              shippingCompanyId: input.shippingCompanyId,
              trackingNumber,
              feePayer: input.feePayer,
            },
          };
        },
      },
      ctx,
    );
  }

  /**
   * `POST /admin/returns/{returnId}/receive` (`RECEIVE_RETURN`, Q29): the
   * carrier brought the parcel back. Writes the `RETURN_RECEIVED` outbox event (API §31).
   */
  function receiveReturn(
    employeeId: string,
    returnId: string,
    input: ReturnStepInput,
    ctx: Ctx,
  ): Promise<AdminReturnView> {
    return staffTransition(
      employeeId,
      returnId,
      "RECEIVED",
      {
        action: "RETURN_RECEIVED",
        reason: input.notes ?? null,
        apply: async (tx, current, now) => {
          await tx.outboxEvent.create({
            data: {
              eventType: "RETURN_RECEIVED",
              aggregateType: "RETURN",
              aggregateId: returnId,
              payload: {
                returnId,
                orderId: current.orderId,
                customerId: current.customerId,
                correlationId: ctx.correlationId,
              },
              availableAt: now,
              createdAt: now,
            },
          });
          return { data: { receivedAt: now } };
        },
      },
      ctx,
    );
  }

  /** `POST /admin/returns/{returnId}/start-inspection` (`INSPECT_RETURN`, Q94). */
  function startInspection(
    employeeId: string,
    returnId: string,
    input: ReturnStepInput,
    ctx: Ctx,
  ): Promise<AdminReturnView> {
    return staffTransition(
      employeeId,
      returnId,
      "INSPECTING",
      {
        action: "RETURN_INSPECTION_STARTED",
        reason: input.notes ?? null,
        apply: async () => ({ data: {} }),
      },
      ctx,
    );
  }

  /**
   * `POST /admin/return-items/{returnItemId}/inspection` (`INSPECT_RETURN`;
   * Q30, Q35, Q36, Q95): records the outcomes of one returned line, once,
   * while the return is `INSPECTING`. Units found sellable go back to
   * Available through a `CUSTOMER_RETURN_RESTOCK` movement in the same
   * transaction; damaged and rejected units never enter sellable stock.
   */
  async function inspectItem(
    employeeId: string,
    returnItemId: string,
    input: InspectReturnItemInput,
    ctx: Ctx,
  ): Promise<AdminReturnView> {
    const now = clock.now();
    const returnId = await runInTransaction(
      async (tx) => {
        const item = await tx.returnItem.findUnique({
          where: { id: returnItemId },
          select: {
            returnId: true,
            requestedQuantity: true,
            orderItem: { select: { productVariantId: true } },
          },
        });
        if (!item) {
          throw new AppError("NOT_FOUND", "Return item not found.");
        }
        // The return row lock serializes inspections and status moves.
        const current = await lockReturn(tx, item.returnId);
        if (!current) {
          throw returnNotFound();
        }
        if (current.status !== "INSPECTING") {
          throw new AppError("RETURN_STATE_INVALID", "The return is not being inspected.", {
            details: { status: current.status, required: "INSPECTING" },
          });
        }
        if ((await tx.returnInspection.count({ where: { returnItemId } })) > 0) {
          throw conflict("This item has already been inspected.", {
            reason: "RETURN_ITEM_ALREADY_INSPECTED",
          });
        }
        const problem = checkInspection(item.requestedQuantity, input.outcomes);
        if (problem?.kind === "RESTOCK_NOT_SELLABLE") {
          throw validationError(
            `outcomes.${problem.index}.condition`,
            "restock_not_sellable",
            "Only units in sellable condition can be restocked.",
          );
        }
        if (problem?.kind === "QUANTITY_MISMATCH") {
          throw validationError(
            "outcomes",
            "quantity_mismatch",
            `The outcomes must cover exactly the ${problem.requested} returned units.`,
          );
        }
        for (const mediaAssetId of input.evidenceMediaAssetIds) {
          await lockAttachableAsset(tx, mediaAssetId, "RETURN_INSPECTION");
        }
        const attached = await tx.returnInspectionEvidence.findFirst({
          where: { mediaAssetId: { in: input.evidenceMediaAssetIds } },
          select: { mediaAssetId: true },
        });
        if (attached) {
          throw conflict("This photo is already attached to an inspection.", {
            reason: "MEDIA_ALREADY_ATTACHED",
            mediaAssetId: attached.mediaAssetId,
          });
        }

        await tx.returnInspection.createMany({
          data: input.outcomes.map((o) => ({
            returnItemId,
            inspectedByEmployeeId: employeeId,
            result: o.result,
            condition: o.condition,
            quantity: o.quantity,
            notes: o.notes ?? null,
            createdAt: now,
          })),
        });
        await tx.returnInspectionEvidence.createMany({
          data: input.evidenceMediaAssetIds.map((mediaAssetId) => ({
            returnItemId,
            mediaAssetId,
            uploadedByEmployeeId: employeeId,
            createdAt: now,
          })),
        });
        const restocked = restockQuantity(input.outcomes);
        if (restocked > 0) {
          await tx.inventoryMovement.create({
            data: {
              productVariantId: item.orderItem.productVariantId,
              movementType: "CUSTOMER_RETURN_RESTOCK",
              availableDelta: restocked,
              referenceType: "RETURN",
              referenceId: item.returnId,
              reason: "Customer return inspected: sellable",
              createdByType: "EMPLOYEE",
              createdById: employeeId,
              createdAt: now,
            },
          });
        }
        await tx.return.update({ where: { id: item.returnId }, data: { updatedAt: now } });
        await recordAudit(tx, {
          actor: employeeActor(employeeId),
          action: "RETURN_ITEM_INSPECTED",
          entityType: AUDIT_ENTITY_TYPES.return,
          entityId: item.returnId,
          next: {
            returnItemId,
            outcomes: input.outcomes,
            restockedQuantity: restocked,
            evidenceMediaAssetIds: input.evidenceMediaAssetIds,
          },
          correlationId: ctx.correlationId,
          createdAt: now,
        });
        return item.returnId;
      },
      {},
      db,
    );
    ctx.logger.info("return item inspected", { returnId, returnItemId });
    return getReturn(returnId);
  }

  return {
    approveReturn,
    rejectReturn,
    requestPickup,
    receiveReturn,
    startInspection,
    inspectItem,
    createReturn,
    resubmitReturn,
    addEvidence,
    cancelReturn,
    getMyReturn,
    listMyReturns,
    listReturns,
    getReturn,
  };
}

export type ReturnsService = ReturnType<typeof createReturnsService>;

let defaultService: ReturnsService | undefined;

export function getReturnsService(): ReturnsService {
  defaultService ??= createReturnsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
