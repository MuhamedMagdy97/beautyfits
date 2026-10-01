import {
  Prisma,
  type ApprovalStatus,
  type ApprovalType,
  type PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db, type TransactionClient } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import { APPROVAL_HANDLERS } from "@/server/modules/approvals/handlers";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  type AuditActor,
} from "@/server/modules/audit/audit";
import { permissionDenied } from "@/server/modules/rbac/authorization";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Approval requests (TASK-013, Audit Correction 7, User Flows §17.3,
 * ADR-0018).
 *
 * A feature that needs Owner/Admin approval (Business Spec R19: purchase
 * orders, over-delivery extras, marketing campaigns, critical settings)
 * calls `requestApproval` inside its own transaction and keeps the action
 * pending. An Owner/Admin then approves or rejects it through
 * `/admin/approval-requests`; the feature's handler (handlers.ts) applies the
 * outcome in the same transaction that resolves the request, so the request
 * and the action never disagree.
 */

export interface ApprovalRequestRecord {
  id: string;
  approvalType: ApprovalType;
  entityType: string;
  entityId: string;
  requestedByEmployeeId: string;
  status: ApprovalStatus;
  requestedAt: Date;
  resolvedByEmployeeId: string | null;
  resolvedAt: Date | null;
  reason: string | null;
  resolutionReason: string | null;
  metadataJson: Prisma.JsonValue | null;
}

export interface ResolutionContext {
  /** The Owner/Admin resolving the request. */
  resolverEmployeeId: string;
  reason: string | null;
  now: Date;
  correlationId: string | null;
}

/**
 * What a feature does when its request is resolved. Both run inside the
 * resolving transaction; throwing an AppError refuses the resolution and
 * leaves the request PENDING (for example when the entity changed since).
 */
export interface ApprovalHandler {
  onApproved(
    tx: TransactionClient,
    request: ApprovalRequestRecord,
    context: ResolutionContext,
  ): Promise<void>;
  onRejected?(
    tx: TransactionClient,
    request: ApprovalRequestRecord,
    context: ResolutionContext,
  ): Promise<void>;
}

export type ApprovalHandlers = Partial<Record<ApprovalType, ApprovalHandler>>;

export interface PersonRef {
  id: string;
  displayName: string;
}

export interface ApprovalRequestView {
  id: string;
  approvalType: ApprovalType;
  entityType: string;
  entityId: string;
  status: ApprovalStatus;
  reason: string | null;
  metadata: unknown;
  requestedBy: PersonRef;
  requestedAt: string;
  resolvedBy: PersonRef | null;
  resolvedAt: string | null;
  resolutionReason: string | null;
}

export interface ApprovalOperationContext {
  now: Date;
  correlationId?: string | null;
}

function auditSnapshot(
  request: Pick<ApprovalRequestRecord, "status" | "approvalType" | "entityType" | "entityId">,
) {
  return {
    status: request.status,
    approvalType: request.approvalType,
    entityType: request.entityType,
    entityId: request.entityId,
  };
}

function pendingConflict(existingId: string): AppError {
  return new AppError("CONFLICT", "An approval request for this is already pending.", {
    details: { reason: "APPROVAL_PENDING", approvalRequestId: existingId },
  });
}

function notPending(status: ApprovalStatus): AppError {
  return new AppError("CONFLICT", "This approval request is no longer pending.", {
    details: { reason: "APPROVAL_NOT_PENDING", status },
  });
}

function requestNotFound(): AppError {
  return new AppError("NOT_FOUND", "Approval request not found.");
}

/** The PENDING request for an entity and type, if any. */
export async function findPendingApproval(
  db: Db,
  approvalType: ApprovalType,
  entityType: string,
  entityId: string,
): Promise<ApprovalRequestRecord | null> {
  return db.approvalRequest.findFirst({
    where: { approvalType, entityType, entityId, status: "PENDING" },
  });
}

/**
 * Opens an approval request. Call it inside the transaction that puts the
 * entity into its pending state. Only one request per type and entity can be
 * PENDING at a time (`409 CONFLICT`, reason `APPROVAL_PENDING`).
 */
export async function requestApproval(
  tx: TransactionClient,
  input: {
    approvalType: ApprovalType;
    entityType: string;
    entityId: string;
    requestedByEmployeeId: string;
    reason?: string | null;
    metadata?: Prisma.InputJsonValue | null;
  },
  context: ApprovalOperationContext,
): Promise<ApprovalRequestRecord> {
  const existing = await findPendingApproval(
    tx,
    input.approvalType,
    input.entityType,
    input.entityId,
  );
  if (existing) {
    throw pendingConflict(existing.id);
  }
  let created: ApprovalRequestRecord;
  try {
    created = await tx.approvalRequest.create({
      data: {
        approvalType: input.approvalType,
        entityType: input.entityType,
        entityId: input.entityId,
        requestedByEmployeeId: input.requestedByEmployeeId,
        status: "PENDING",
        requestedAt: context.now,
        reason: input.reason ?? null,
        metadataJson: input.metadata ?? undefined,
      },
    });
  } catch (error) {
    // A concurrent request won the partial unique index.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "An approval request for this is already pending.", {
        details: { reason: "APPROVAL_PENDING" },
      });
    }
    throw error;
  }
  await recordAudit(tx, {
    actor: employeeActor(input.requestedByEmployeeId),
    action: "APPROVAL_REQUESTED",
    entityType: AUDIT_ENTITY_TYPES.approvalRequest,
    entityId: created.id,
    next: { ...auditSnapshot(created), metadata: input.metadata ?? null },
    reason: created.reason,
    correlationId: context.correlationId ?? null,
    createdAt: context.now,
  });
  return created;
}

/**
 * Withdraws a PENDING request, for example when the feature cancels the
 * entity it was about. The feature decides who may do this. Returns null
 * when the request was not pending (nothing changes).
 */
export async function cancelApprovalRequest(
  tx: TransactionClient,
  input: { approvalRequestId: string; actor: AuditActor; reason?: string | null },
  context: ApprovalOperationContext,
): Promise<ApprovalRequestRecord | null> {
  const resolverEmployeeId = input.actor.type === "EMPLOYEE" ? (input.actor.id ?? null) : null;
  const updated = await tx.approvalRequest.updateMany({
    where: { id: input.approvalRequestId, status: "PENDING" },
    data: {
      status: "CANCELLED",
      resolvedByEmployeeId: resolverEmployeeId,
      resolvedAt: context.now,
      resolutionReason: input.reason ?? null,
    },
  });
  if (updated.count === 0) {
    return null;
  }
  const request = await tx.approvalRequest.findUniqueOrThrow({
    where: { id: input.approvalRequestId },
  });
  await recordAudit(tx, {
    actor: input.actor,
    action: "APPROVAL_CANCELLED",
    entityType: AUDIT_ENTITY_TYPES.approvalRequest,
    entityId: request.id,
    previous: { status: "PENDING" },
    next: auditSnapshot(request),
    reason: request.resolutionReason,
    correlationId: context.correlationId ?? null,
    createdAt: context.now,
  });
  return request;
}

const viewInclude = {
  requestedBy: { select: { id: true, displayName: true } },
  resolvedBy: { select: { id: true, displayName: true } },
} as const satisfies Prisma.ApprovalRequestInclude;

type ViewRow = Prisma.ApprovalRequestGetPayload<{ include: typeof viewInclude }>;

function toView(row: ViewRow): ApprovalRequestView {
  return {
    id: row.id,
    approvalType: row.approvalType,
    entityType: row.entityType,
    entityId: row.entityId,
    status: row.status,
    reason: row.reason,
    metadata: row.metadataJson,
    requestedBy: { id: row.requestedBy.id, displayName: row.requestedBy.displayName },
    requestedAt: row.requestedAt.toISOString(),
    resolvedBy: row.resolvedBy
      ? { id: row.resolvedBy.id, displayName: row.resolvedBy.displayName }
      : null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionReason: row.resolutionReason,
  };
}

export interface ApprovalListQuery {
  page: number;
  pageSize: number;
  status?: ApprovalStatus;
  approvalType?: ApprovalType;
  entityType?: string;
  entityId?: string;
}

export interface ApprovalServiceDeps {
  db: PrismaClient;
  clock: Clock;
  handlers?: ApprovalHandlers;
}

export function createApprovalService(deps: ApprovalServiceDeps) {
  const { db, clock } = deps;
  const handlers = deps.handlers ?? APPROVAL_HANDLERS;

  async function listApprovalRequests(
    query: ApprovalListQuery,
  ): Promise<{ items: ApprovalRequestView[]; pagination: Pagination }> {
    const where: Prisma.ApprovalRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.approvalType ? { approvalType: query.approvalType } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [total, rows] = await Promise.all([
      db.approvalRequest.count({ where }),
      db.approvalRequest.findMany({
        where,
        include: viewInclude,
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toView),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async function getApprovalRequest(id: string): Promise<ApprovalRequestView> {
    const row = await db.approvalRequest.findUnique({ where: { id }, include: viewInclude });
    if (!row) {
      throw requestNotFound();
    }
    return toView(row);
  }

  async function resolve(
    outcome: "APPROVED" | "REJECTED",
    resolverEmployeeId: string,
    id: string,
    input: { reason?: string | null },
    correlationId: string | null,
  ): Promise<ApprovalRequestView> {
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        // Row lock: one resolution at a time; the loser sees it resolved.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM approval_requests WHERE id = ${id}::uuid FOR UPDATE`;
        if (locked.length === 0) {
          throw requestNotFound();
        }
        const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id } });
        if (request.status !== "PENDING") {
          throw notPending(request.status);
        }
        if (request.requestedByEmployeeId === resolverEmployeeId) {
          throw permissionDenied("You cannot resolve your own approval request.", {
            reason: "SELF_APPROVAL",
          });
        }
        const handler = handlers[request.approvalType];
        if (outcome === "APPROVED" && !handler) {
          // A request type without a handler is a deployment error.
          throw new Error(`No approval handler for ${request.approvalType}`);
        }

        const reason = input.reason ?? null;
        const resolved = await tx.approvalRequest.update({
          where: { id },
          data: {
            status: outcome,
            resolvedByEmployeeId: resolverEmployeeId,
            resolvedAt: now,
            resolutionReason: reason,
          },
        });
        const context: ResolutionContext = { resolverEmployeeId, reason, now, correlationId };
        if (outcome === "APPROVED") {
          await handler!.onApproved(tx, resolved, context);
        } else {
          await handler?.onRejected?.(tx, resolved, context);
        }
        await recordAudit(tx, {
          actor: employeeActor(resolverEmployeeId),
          action: outcome === "APPROVED" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
          entityType: AUDIT_ENTITY_TYPES.approvalRequest,
          entityId: id,
          previous: { status: "PENDING" },
          next: auditSnapshot(resolved),
          reason,
          correlationId,
          createdAt: now,
        });
      },
      {},
      db,
    );
    return getApprovalRequest(id);
  }

  /** Approves a PENDING request and applies it (`APPROVAL_RESOLVE`, Owner/Admin). */
  function approve(
    resolverEmployeeId: string,
    id: string,
    input: { reason?: string | null },
    correlationId: string | null = null,
  ): Promise<ApprovalRequestView> {
    return resolve("APPROVED", resolverEmployeeId, id, input, correlationId);
  }

  /** Rejects a PENDING request; a reason is required (`APPROVAL_RESOLVE`, Owner/Admin). */
  function reject(
    resolverEmployeeId: string,
    id: string,
    input: { reason: string },
    correlationId: string | null = null,
  ): Promise<ApprovalRequestView> {
    return resolve("REJECTED", resolverEmployeeId, id, input, correlationId);
  }

  return { listApprovalRequests, getApprovalRequest, approve, reject };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;

let defaultService: ApprovalService | undefined;

export function getApprovalService(): ApprovalService {
  defaultService ??= createApprovalService({ db: getDb(), clock: systemClock });
  return defaultService;
}
