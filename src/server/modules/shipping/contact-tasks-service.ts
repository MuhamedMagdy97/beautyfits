import type {
  ContactTaskReason,
  ContactTaskStatus,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import type { OrderActor } from "@/server/modules/orders/orders-service";
import type {
  ListContactTasksQuery,
  UpdateContactTaskInput,
} from "@/server/modules/shipping/schemas";
import { readDeliveryFailureContactThreshold } from "@/server/modules/settings/settings";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Customer-contact tasks (TASK-035, Business Spec Q19, Q129; User Flows §10;
 * API §16; ADR-0047).
 *
 * A failed delivery attempt that brings a shipment's failed attempts to the
 * configured threshold or beyond opens a `DELIVERY_FAILED_THRESHOLD` task,
 * unless the shipment already has an unfinished one. Staff with
 * CONTACT_TASK_MANAGE list them, assign them, record the outcome and close
 * them (`RESOLVED` / `CANCELLED`, final).
 */

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

const ACTIVE: readonly ContactTaskStatus[] = ["OPEN", "IN_PROGRESS"];

/**
 * Opens the threshold task for a shipment whose failed attempts reached the
 * threshold, inside the caller's transaction (the shipment row is locked).
 * Returns the new task id, or null when none was needed.
 */
export async function openContactTaskAtThreshold(
  tx: Db,
  input: { orderId: string; shipmentId: string; attemptCount: number; now: Date; logger: Logger },
): Promise<string | null> {
  const threshold = await readDeliveryFailureContactThreshold(tx, input.logger);
  if (input.attemptCount < threshold) {
    return null;
  }
  const active = await tx.customerContactTask.findFirst({
    where: {
      shipmentId: input.shipmentId,
      reason: "DELIVERY_FAILED_THRESHOLD",
      status: { in: [...ACTIVE] },
    },
    select: { id: true },
  });
  if (active) {
    return null;
  }
  const task = await tx.customerContactTask.create({
    data: {
      orderId: input.orderId,
      shipmentId: input.shipmentId,
      reason: "DELIVERY_FAILED_THRESHOLD",
      createdAt: input.now,
      updatedAt: input.now,
    },
    select: { id: true },
  });
  return task.id;
}

const TASK_INCLUDE = {
  order: { select: { orderNumber: true } },
  shipment: { select: { attemptCount: true } },
  assignedTo: { select: { id: true, displayName: true } },
  resolvedBy: { select: { id: true, displayName: true } },
} as const satisfies Prisma.CustomerContactTaskInclude;

type TaskRow = Prisma.CustomerContactTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export interface ContactTaskView {
  id: string;
  orderId: string;
  orderNumber: string;
  shipmentId: string | null;
  /** The shipment's failed attempts now. */
  attemptCount: number | null;
  reason: ContactTaskReason;
  status: ContactTaskStatus;
  assignedEmployee: { id: string; displayName: string } | null;
  outcomeNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: { id: string; displayName: string } | null;
}

function toView(row: TaskRow): ContactTaskView {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    shipmentId: row.shipmentId,
    attemptCount: row.shipment?.attemptCount ?? null,
    reason: row.reason,
    status: row.status,
    assignedEmployee: row.assignedTo,
    outcomeNotes: row.outcomeNotes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
  };
}

function pagination(query: { page: number; pageSize: number }, total: number): Pagination {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export function createContactTasksService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  /** `GET /admin/contact-tasks`: oldest first, so the longest-waiting comes first. */
  async function list(query: ListContactTasksQuery) {
    const where: Prisma.CustomerContactTaskWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
    };
    const [total, rows] = await Promise.all([
      db.customerContactTask.count({ where }),
      db.customerContactTask.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toView), pagination: pagination(query, total) };
  }

  /** `PATCH /admin/contact-tasks/{taskId}`. */
  async function update(
    actor: OrderActor,
    taskId: string,
    input: UpdateContactTaskInput,
    ctx: Ctx,
  ): Promise<ContactTaskView> {
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          {
            status: ContactTaskStatus;
            assignedEmployeeId: string | null;
            outcomeNotes: string | null;
          }[]
        >`SELECT status, assigned_employee_id AS "assignedEmployeeId", outcome_notes AS "outcomeNotes"
          FROM customer_contact_tasks WHERE id = ${taskId}::uuid FOR UPDATE`;
        const task = rows[0];
        if (!task) {
          throw new AppError("NOT_FOUND", "Contact task not found.");
        }
        if (!ACTIVE.includes(task.status)) {
          throw conflict("This contact task is closed.", {
            reason: "CONTACT_TASK_CLOSED",
            status: task.status,
          });
        }
        if (input.assignedEmployeeId) {
          const employee = await tx.employee.findUnique({
            where: { id: input.assignedEmployeeId },
            select: { status: true },
          });
          if (!employee) {
            throw validationError("assignedEmployeeId", "not_found", "Unknown employee.");
          }
          if (employee.status !== "ACTIVE") {
            throw validationError("assignedEmployeeId", "inactive", "This employee is inactive.");
          }
        }
        const closing = input.status === "RESOLVED" || input.status === "CANCELLED";
        const next = {
          ...(input.status ? { status: input.status } : {}),
          ...(input.assignedEmployeeId !== undefined
            ? { assignedEmployeeId: input.assignedEmployeeId }
            : {}),
          ...(input.outcomeNotes !== undefined ? { outcomeNotes: input.outcomeNotes } : {}),
        };
        await tx.customerContactTask.update({
          where: { id: taskId },
          data: {
            ...next,
            updatedAt: now,
            ...(closing ? { resolvedAt: now, resolvedByEmployeeId: actor.employeeId } : {}),
          },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "CONTACT_TASK_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.contactTask,
          entityId: taskId,
          previous: {
            status: task.status,
            assignedEmployeeId: task.assignedEmployeeId,
            outcomeNotes: task.outcomeNotes,
          },
          next,
          correlationId: ctx.correlationId,
          createdAt: now,
        });
      },
      {},
      db,
    );
    ctx.logger.info("contact task updated", { taskId });
    return toView(
      await db.customerContactTask.findUniqueOrThrow({
        where: { id: taskId },
        include: TASK_INCLUDE,
      }),
    );
  }

  return { list, update };
}

export type ContactTasksService = ReturnType<typeof createContactTasksService>;

let defaultService: ContactTasksService | undefined;

export function getContactTasksService(): ContactTasksService {
  defaultService ??= createContactTasksService({ db: getDb(), clock: systemClock });
  return defaultService;
}
