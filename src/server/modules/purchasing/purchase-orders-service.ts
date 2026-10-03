import type { Prisma, PrismaClient, PurchaseOrderStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db, type TransactionClient } from "@/server/db/transaction";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import {
  cancelApprovalRequest,
  findPendingApproval,
  getApprovalService,
  requestApproval,
} from "@/server/modules/approvals/approvals";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import {
  approvePurchase,
  assertStatus,
  changeStatus,
  lockPurchase,
  purchaseNotFound,
} from "@/server/modules/purchasing/purchase-orders";
import type {
  CreatePurchaseInput,
  ListPurchasesQuery,
  PurchaseItemInput,
  UpdatePurchaseInput,
} from "@/server/modules/purchasing/schemas";
import { permissionDenied, type PermissionSet } from "@/server/modules/rbac/authorization";
import { toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Purchase orders (TASK-022, Business Spec Q101, Q102, Q112, Q113, User Flows
 * §14, API §21, ADR-0027).
 *
 * DRAFT → PENDING_APPROVAL → APPROVED → SENT; CANCELLED before receiving.
 * - Only drafts are edited; a rejected order goes back to DRAFT.
 * - Submitting opens a `PURCHASE_ORDER` approval request for an Owner/Admin.
 *   An order submitted by someone holding `PURCHASE_APPROVE` (Owner/Admin) is
 *   approved at once, so a single Owner is never blocked (owner decision).
 * - Inactive suppliers and archived products/variants get no new orders.
 * - Nothing here changes stock: goods receipts do (TASK-023).
 */

export interface PurchaseActor {
  employeeId: string;
  permissions: PermissionSet;
}

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

export interface PersonRef {
  id: string;
  displayName: string;
}

export interface PurchaseItemView {
  id: string;
  variantId: string;
  sku: string;
  productNameAr: string;
  productNameEn: string;
  variantNameAr: string | null;
  variantNameEn: string | null;
  orderedQuantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseSummaryView {
  id: string;
  purchaseNumber: string;
  status: PurchaseOrderStatus;
  supplier: { id: string; name: string };
  orderedTotal: number;
  currency: string;
  notes: string | null;
  createdBy: PersonRef;
  submittedAt: string | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  sentAt: string | null;
  cancelledBy: PersonRef | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseView extends PurchaseSummaryView {
  items: PurchaseItemView[];
  /** The latest approval request: shows a rejection reason to the creator. */
  approval: {
    id: string;
    status: string;
    resolutionReason: string | null;
    resolvedAt: string | null;
  } | null;
}

const person = { select: { id: true, displayName: true } } as const;

const summaryInclude = {
  supplier: { select: { id: true, name: true } },
  createdBy: person,
  approvedBy: person,
  cancelledBy: person,
} as const satisfies Prisma.PurchaseOrderInclude;

const viewInclude = {
  ...summaryInclude,
  items: {
    orderBy: { id: "asc" },
    include: {
      variant: {
        select: {
          sku: true,
          variantNameAr: true,
          variantNameEn: true,
          product: { select: { nameAr: true, nameEn: true } },
        },
      },
    },
  },
} as const satisfies Prisma.PurchaseOrderInclude;

type SummaryRow = Prisma.PurchaseOrderGetPayload<{ include: typeof summaryInclude }>;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toSummary(row: SummaryRow): PurchaseSummaryView {
  return {
    id: row.id,
    purchaseNumber: row.purchaseNumber,
    status: row.status,
    supplier: row.supplier,
    orderedTotal: toJsonNumber(row.orderedTotal),
    currency: row.currency,
    notes: row.notes,
    createdBy: row.createdBy,
    submittedAt: iso(row.submittedAt),
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    sentAt: iso(row.sentAt),
    cancelledBy: row.cancelledBy,
    cancelledAt: iso(row.cancelledAt),
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadView(db: Db, purchaseId: string): Promise<PurchaseView> {
  const row = await db.purchaseOrder.findUnique({
    where: { id: purchaseId },
    include: viewInclude,
  });
  if (!row) {
    throw purchaseNotFound();
  }
  const approval = await db.approvalRequest.findFirst({
    where: {
      approvalType: "PURCHASE_ORDER",
      entityType: AUDIT_ENTITY_TYPES.purchaseOrder,
      entityId: purchaseId,
    },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
  });
  return {
    ...toSummary(row),
    items: row.items.map((item) => ({
      id: item.id,
      variantId: item.productVariantId,
      sku: item.variant.sku,
      productNameAr: item.variant.product.nameAr,
      productNameEn: item.variant.product.nameEn,
      variantNameAr: item.variant.variantNameAr,
      variantNameEn: item.variant.variantNameEn,
      orderedQuantity: item.orderedQuantity,
      unitCost: toJsonNumber(item.unitCost),
      lineTotal: toJsonNumber(item.lineTotal),
    })),
    approval: approval && {
      id: approval.id,
      status: approval.status,
      resolutionReason: approval.resolutionReason,
      resolvedAt: iso(approval.resolvedAt),
    },
  };
}

/** Locks the supplier (`FOR SHARE`) against a concurrent deactivation (ADR-0026). */
async function assertSupplierActive(tx: Db, supplierId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM suppliers WHERE id = ${supplierId}::uuid FOR SHARE`;
  if (rows.length === 0) {
    throw validationError("supplierId", "supplier_not_found", "The supplier does not exist.");
  }
  if (rows[0].status !== "ACTIVE") {
    throw conflict("The supplier is inactive.", { reason: "SUPPLIER_INACTIVE", supplierId });
  }
}

interface Line {
  productVariantId: string;
  orderedQuantity: number;
  unitCost: bigint;
  lineTotal: bigint;
}

/**
 * Checks every variant exists and neither it nor its product is archived;
 * returns the lines with their totals.
 * ponytail: no lock on the variants; an archive racing a create can slip
 * through, and the check runs again at submit.
 */
async function checkedLines(tx: Db, items: readonly PurchaseItemInput[]): Promise<Line[]> {
  const variants = await tx.productVariant.findMany({
    where: { id: { in: items.map((item) => item.variantId) } },
    select: { id: true, status: true, product: { select: { status: true } } },
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  return items.map((item, index) => {
    const variant = byId.get(item.variantId);
    if (!variant) {
      throw validationError(
        `items.${index}.variantId`,
        "variant_not_found",
        "The variant does not exist.",
      );
    }
    if (variant.status === "ARCHIVED" || variant.product.status === "ARCHIVED") {
      throw conflict("An archived product or variant cannot be purchased.", {
        reason: "VARIANT_ARCHIVED",
        variantId: item.variantId,
      });
    }
    return {
      productVariantId: item.variantId,
      orderedQuantity: item.quantity,
      unitCost: item.unitCost,
      lineTotal: item.unitCost * BigInt(item.quantity),
    };
  });
}

function total(lines: readonly Line[]): bigint {
  return lines.reduce((sum, line) => sum + line.lineTotal, BigInt(0));
}

function snapshot(supplierId: string, notes: string | null, lines: readonly Line[]) {
  return {
    supplierId,
    notes,
    orderedTotal: toJsonNumber(total(lines)),
    items: lines.map((line) => ({
      variantId: line.productVariantId,
      quantity: line.orderedQuantity,
      unitCost: toJsonNumber(line.unitCost),
    })),
  };
}

async function currentLines(tx: Db, purchaseId: string): Promise<Line[]> {
  return tx.purchaseItem.findMany({
    where: { purchaseOrderId: purchaseId },
    orderBy: { id: "asc" },
    select: { productVariantId: true, orderedQuantity: true, unitCost: true, lineTotal: true },
  });
}

export function createPurchaseOrdersService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  function inTx<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return runInTransaction(work, {}, db);
  }

  async function createPurchase(
    actor: PurchaseActor,
    input: CreatePurchaseInput,
    ctx: Ctx,
  ): Promise<PurchaseView> {
    const now = clock.now();
    const view = await inTx(async (tx) => {
      await assertSupplierActive(tx, input.supplierId);
      const lines = await checkedLines(tx, input.items);
      const created = await tx.purchaseOrder.create({
        data: {
          supplierId: input.supplierId,
          notes: input.notes ?? null,
          orderedTotal: total(lines),
          createdByEmployeeId: actor.employeeId,
          createdAt: now,
          updatedAt: now,
          items: { create: lines },
        },
      });
      await recordAudit(tx, {
        actor: employeeActor(actor.employeeId),
        action: "PURCHASE_ORDER_CREATED",
        entityType: AUDIT_ENTITY_TYPES.purchaseOrder,
        entityId: created.id,
        next: { ...snapshot(input.supplierId, created.notes, lines), status: "DRAFT" },
        correlationId: ctx.correlationId,
        createdAt: now,
      });
      return loadView(tx, created.id);
    });
    ctx.logger.info("purchase order created", {
      purchaseId: view.id,
      actorEmployeeId: actor.employeeId,
    });
    return view;
  }

  async function updatePurchase(
    actor: PurchaseActor,
    purchaseId: string,
    input: UpdatePurchaseInput,
    ctx: Ctx,
  ): Promise<PurchaseView> {
    const now = clock.now();
    return inTx(async (tx) => {
      const order = await lockPurchase(tx, purchaseId);
      assertStatus(order.status, ["DRAFT"], "edit");
      const existing = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseId } });
      const oldLines = await currentLines(tx, purchaseId);
      const supplierId = input.supplierId ?? existing.supplierId;
      const notes = input.notes === undefined ? existing.notes : input.notes;
      const lines = input.items ? await checkedLines(tx, input.items) : oldLines;
      const previous = snapshot(existing.supplierId, existing.notes, oldLines);
      const next = snapshot(supplierId, notes, lines);
      if (JSON.stringify(previous) === JSON.stringify(next)) {
        return loadView(tx, purchaseId);
      }
      if (supplierId !== existing.supplierId) {
        await assertSupplierActive(tx, supplierId);
      }
      if (input.items) {
        await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: purchaseId } });
        await tx.purchaseItem.createMany({
          data: lines.map((line) => ({ ...line, purchaseOrderId: purchaseId })),
        });
      }
      await tx.purchaseOrder.update({
        where: { id: purchaseId },
        data: { supplierId, notes, orderedTotal: total(lines), updatedAt: now },
      });
      await recordAudit(tx, {
        actor: employeeActor(actor.employeeId),
        action: "PURCHASE_ORDER_UPDATED",
        entityType: AUDIT_ENTITY_TYPES.purchaseOrder,
        entityId: purchaseId,
        previous,
        next,
        correlationId: ctx.correlationId,
        createdAt: now,
      });
      return loadView(tx, purchaseId);
    });
  }

  async function submitPurchase(
    actor: PurchaseActor,
    purchaseId: string,
    input: { reason?: string },
    ctx: Ctx,
  ): Promise<PurchaseView> {
    const now = clock.now();
    const change = { employeeId: actor.employeeId, now, correlationId: ctx.correlationId };
    return inTx(async (tx) => {
      const order = await lockPurchase(tx, purchaseId);
      assertStatus(order.status, ["DRAFT"], "submit");
      const existing = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseId } });
      await assertSupplierActive(tx, existing.supplierId);
      const lines = await currentLines(tx, purchaseId);
      await checkedLines(
        tx,
        lines.map((line) => ({
          variantId: line.productVariantId,
          quantity: line.orderedQuantity,
          unitCost: line.unitCost,
        })),
      );
      await changeStatus(
        tx,
        purchaseId,
        "DRAFT",
        "PENDING_APPROVAL",
        "PURCHASE_ORDER_SUBMITTED",
        { ...change, reason: input.reason },
        { submittedAt: now },
      );
      if (actor.permissions.has("PURCHASE_APPROVE")) {
        // Owner/Admin: approved on submit (ADR-0027 §3).
        await approvePurchase(tx, purchaseId, "PENDING_APPROVAL", {
          ...change,
          reason: "Approved on submit (Owner/Admin).",
        });
      } else {
        await requestApproval(
          tx,
          {
            approvalType: "PURCHASE_ORDER",
            entityType: AUDIT_ENTITY_TYPES.purchaseOrder,
            entityId: purchaseId,
            requestedByEmployeeId: actor.employeeId,
            reason: input.reason ?? null,
            metadata: {
              purchaseNumber: existing.purchaseNumber,
              supplierId: existing.supplierId,
              orderedTotal: toJsonNumber(existing.orderedTotal),
            },
          },
          { now, correlationId: ctx.correlationId },
        );
      }
      return loadView(tx, purchaseId);
    });
  }

  /** Resolves the order's pending approval request (`PURCHASE_APPROVE`). */
  async function resolvePurchase(
    outcome: "approve" | "reject",
    actor: PurchaseActor,
    purchaseId: string,
    input: { reason?: string },
    ctx: Ctx,
  ): Promise<PurchaseView> {
    const pending = await findPendingApproval(
      db,
      "PURCHASE_ORDER",
      AUDIT_ENTITY_TYPES.purchaseOrder,
      purchaseId,
    );
    if (!pending) {
      const order = await db.purchaseOrder.findUnique({
        where: { id: purchaseId },
        select: { status: true },
      });
      if (!order) {
        throw purchaseNotFound();
      }
      assertStatus(order.status, ["PENDING_APPROVAL"], outcome);
      throw conflict("This purchase order has no pending approval request.", {
        reason: "PURCHASE_STATUS_INVALID",
        status: order.status,
      });
    }
    const approvals = getApprovalService();
    if (outcome === "approve") {
      await approvals.approve(actor.employeeId, pending.id, input, ctx.correlationId);
    } else {
      await approvals.reject(
        actor.employeeId,
        pending.id,
        { reason: input.reason! },
        ctx.correlationId,
      );
    }
    return loadView(db, purchaseId);
  }

  async function sendPurchase(
    actor: PurchaseActor,
    purchaseId: string,
    ctx: Ctx,
  ): Promise<PurchaseView> {
    const now = clock.now();
    return inTx(async (tx) => {
      const order = await lockPurchase(tx, purchaseId);
      assertStatus(order.status, ["APPROVED"], "send");
      await changeStatus(
        tx,
        purchaseId,
        "APPROVED",
        "SENT",
        "PURCHASE_ORDER_SENT",
        { employeeId: actor.employeeId, now, correlationId: ctx.correlationId },
        { sentAt: now },
      );
      return loadView(tx, purchaseId);
    });
  }

  async function cancelPurchase(
    actor: PurchaseActor,
    purchaseId: string,
    input: { reason: string },
    ctx: Ctx,
  ): Promise<PurchaseView> {
    const now = clock.now();
    return inTx(async (tx) => {
      const order = await lockPurchase(tx, purchaseId);
      assertStatus(order.status, ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"], "cancel");
      if (
        (order.status === "APPROVED" || order.status === "SENT") &&
        !actor.permissions.has("PURCHASE_APPROVE")
      ) {
        throw permissionDenied("Cancelling an approved purchase order needs PURCHASE_APPROVE.", {
          reason: "PURCHASE_APPROVE_REQUIRED",
        });
      }
      if (order.status === "PENDING_APPROVAL") {
        const pending = await findPendingApproval(
          tx,
          "PURCHASE_ORDER",
          AUDIT_ENTITY_TYPES.purchaseOrder,
          purchaseId,
        );
        if (pending) {
          await cancelApprovalRequest(
            tx,
            {
              approvalRequestId: pending.id,
              actor: employeeActor(actor.employeeId),
              reason: input.reason,
            },
            { now, correlationId: ctx.correlationId },
          );
        }
      }
      await changeStatus(
        tx,
        purchaseId,
        order.status,
        "CANCELLED",
        "PURCHASE_ORDER_CANCELLED",
        {
          employeeId: actor.employeeId,
          now,
          correlationId: ctx.correlationId,
          reason: input.reason,
        },
        {
          cancelledByEmployeeId: actor.employeeId,
          cancelledAt: now,
          cancellationReason: input.reason,
        },
      );
      return loadView(tx, purchaseId);
    });
  }

  function getPurchase(purchaseId: string): Promise<PurchaseView> {
    return loadView(db, purchaseId);
  }

  async function listPurchases(
    query: ListPurchasesQuery,
  ): Promise<{ items: PurchaseSummaryView[]; pagination: Pagination }> {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.search ? { purchaseNumber: { contains: query.search, mode: "insensitive" } } : {}),
    };
    const [count, rows] = await Promise.all([
      db.purchaseOrder.count({ where }),
      db.purchaseOrder.findMany({
        where,
        include: summaryInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: count,
        totalPages: Math.ceil(count / query.pageSize),
      },
    };
  }

  return {
    createPurchase,
    updatePurchase,
    submitPurchase,
    approvePurchase: (a: PurchaseActor, id: string, input: { reason?: string }, ctx: Ctx) =>
      resolvePurchase("approve", a, id, input, ctx),
    rejectPurchase: (a: PurchaseActor, id: string, input: { reason: string }, ctx: Ctx) =>
      resolvePurchase("reject", a, id, input, ctx),
    sendPurchase,
    cancelPurchase,
    getPurchase,
    listPurchases,
  };
}

export type PurchaseOrdersService = ReturnType<typeof createPurchaseOrdersService>;

let defaultService: PurchaseOrdersService | undefined;

export function getPurchaseOrdersService(): PurchaseOrdersService {
  defaultService ??= createPurchaseOrdersService({ db: getDb(), clock: systemClock });
  return defaultService;
}
