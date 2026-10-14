import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type TransactionClient } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import {
  requestApproval,
  type ApprovalHandler,
  type PersonRef,
} from "@/server/modules/approvals/approvals";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import {
  DEFINITIONS_BY_KEY,
  SETTING_DEFINITIONS,
  type SettingUnit,
} from "@/server/modules/settings/settings";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Reading and changing settings (TASK-057, Q179–Q181, API §26, ADR-0054).
 *
 * - A non-critical setting changes at once.
 * - A critical setting (Q180) opens a `CRITICAL_SETTING` approval request;
 *   another Owner/Admin approves it and the handler below applies it.
 * - Every applied change writes a `setting_history` row (old value, new value,
 *   who changed it, who approved it, when; Q181) and a `SETTING_CHANGED` audit
 *   entry, in the same transaction.
 */

export const SETTING_ENTITY_TYPE = AUDIT_ENTITY_TYPES.setting;

export interface SettingView {
  key: string;
  dataType: string;
  value: unknown;
  defaultValue: unknown;
  critical: boolean;
  unit: SettingUnit | null;
  options: readonly string[] | null;
  source: string;
  updatedBy: PersonRef | null;
  updatedAt: string | null;
  pendingApproval: {
    id: string;
    value: unknown;
    requestedBy: PersonRef;
    requestedAt: string;
  } | null;
}

export interface SettingHistoryView {
  id: string;
  key: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: PersonRef;
  approvedBy: PersonRef | null;
  createdAt: string;
}

export type SettingChangeOutcome = "APPLIED" | "PENDING_APPROVAL" | "UNCHANGED";

/** What the approval request remembers (`metadata`). */
interface PendingChange {
  key: string;
  previousValue: unknown;
  newValue: unknown;
}

function definitionOf(key: string) {
  const definition = DEFINITIONS_BY_KEY.get(key);
  if (!definition) {
    throw new AppError("NOT_FOUND", "Setting not found.");
  }
  return definition;
}

function invalidValue(key: string): AppError {
  return new AppError("VALIDATION_ERROR", "Request validation failed.", {
    details: {
      issues: [
        { path: "value", code: "setting_value_invalid", message: `Invalid value for ${key}.` },
      ],
    },
  });
}

/** Serializes changes of one key, also when no row exists yet. */
async function lockKey(tx: TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`setting:${key}`}))`;
}

/** The value in effect: the stored one when valid, otherwise the default. */
async function currentValue(tx: TransactionClient, key: string): Promise<unknown> {
  const definition = definitionOf(key);
  const row = await tx.setting.findUnique({ where: { key }, select: { valueJson: true } });
  return row && definition.isValid(row.valueJson) ? row.valueJson : definition.defaultValue;
}

/** Stores the value, its history row and its audit entry. */
async function applyChange(
  tx: TransactionClient,
  input: {
    key: string;
    previousValue: unknown;
    newValue: unknown;
    changedByEmployeeId: string;
    approvedByEmployeeId: string | null;
    actorEmployeeId: string;
    reason: string | null;
    correlationId: string | null;
    now: Date;
  },
): Promise<void> {
  const definition = definitionOf(input.key);
  const value = input.newValue as Prisma.InputJsonValue;
  await tx.setting.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      valueJson: value,
      dataType: definition.dataType,
      updatedByEmployeeId: input.changedByEmployeeId,
      updatedAt: input.now,
    },
    update: {
      valueJson: value,
      updatedByEmployeeId: input.changedByEmployeeId,
      updatedAt: input.now,
    },
  });
  await tx.settingHistory.create({
    data: {
      settingKey: input.key,
      oldValueJson: input.previousValue as Prisma.InputJsonValue,
      newValueJson: value,
      changedByEmployeeId: input.changedByEmployeeId,
      approvedByEmployeeId: input.approvedByEmployeeId,
      createdAt: input.now,
    },
  });
  await recordAudit(tx, {
    actor: employeeActor(input.actorEmployeeId),
    action: "SETTING_CHANGED",
    entityType: SETTING_ENTITY_TYPE,
    entityId: input.key,
    previous: { value: input.previousValue as Prisma.InputJsonValue },
    next: {
      value,
      critical: definition.critical,
      changedByEmployeeId: input.changedByEmployeeId,
      approvedByEmployeeId: input.approvedByEmployeeId,
    },
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

/**
 * Applies an approved critical change (ADR-0018 handler). Refuses with
 * `409 SETTING_CHANGED_SINCE` when the value in effect is no longer the one
 * the request was made against; the request then stays pending.
 */
export const criticalSettingApprovalHandler: ApprovalHandler = {
  async onApproved(tx, request, context) {
    const change = request.metadataJson as unknown as PendingChange;
    const definition = definitionOf(change.key);
    await lockKey(tx, change.key);
    const current = await currentValue(tx, change.key);
    if (JSON.stringify(current) !== JSON.stringify(change.previousValue)) {
      throw new AppError("CONFLICT", "The setting changed since this request was made.", {
        details: { reason: "SETTING_CHANGED_SINCE" },
      });
    }
    if (!definition.isValid(change.newValue)) {
      throw invalidValue(change.key);
    }
    await applyChange(tx, {
      key: change.key,
      previousValue: change.previousValue,
      newValue: change.newValue,
      changedByEmployeeId: request.requestedByEmployeeId,
      approvedByEmployeeId: context.resolverEmployeeId,
      actorEmployeeId: context.resolverEmployeeId,
      reason: context.reason ?? request.reason,
      correlationId: context.correlationId,
      now: context.now,
    });
  },
};

const person = { select: { id: true, displayName: true } } as const;

export function createSettingsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function viewOf(key: string): Promise<SettingView> {
    return (await listSettings([key]))[0];
  }

  /** Every known setting with its value in effect (`GET /admin/settings`). */
  async function listSettings(
    keys: readonly string[] = SETTING_DEFINITIONS.map((d) => d.key),
  ): Promise<SettingView[]> {
    const [rows, pending] = await Promise.all([
      db.setting.findMany({ where: { key: { in: [...keys] } }, include: { updatedBy: person } }),
      db.approvalRequest.findMany({
        where: {
          approvalType: "CRITICAL_SETTING",
          entityType: SETTING_ENTITY_TYPE,
          entityId: { in: [...keys] },
          status: "PENDING",
        },
        include: { requestedBy: person },
      }),
    ]);
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const pendingByKey = new Map(pending.map((request) => [request.entityId, request]));
    return keys.map((key) => {
      const definition = definitionOf(key);
      const row = rowByKey.get(key);
      const request = pendingByKey.get(key);
      const valid = row !== undefined && definition.isValid(row.valueJson);
      return {
        key,
        dataType: definition.dataType,
        value: valid ? row.valueJson : definition.defaultValue,
        defaultValue: definition.defaultValue,
        critical: definition.critical,
        unit: definition.unit ?? null,
        options: definition.options ?? null,
        source: definition.source,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row && row.updatedByEmployeeId ? row.updatedAt.toISOString() : null,
        pendingApproval: request
          ? {
              id: request.id,
              value: (request.metadataJson as unknown as PendingChange | null)?.newValue ?? null,
              requestedBy: request.requestedBy,
              requestedAt: request.requestedAt.toISOString(),
            }
          : null,
      };
    });
  }

  /**
   * Changes or proposes a change (`PATCH /admin/settings/{key}`,
   * `SETTINGS_MANAGE`). The same value as now changes nothing.
   */
  async function changeSetting(
    employeeId: string,
    key: string,
    input: { value: unknown; reason?: string | null },
    correlationId: string | null = null,
  ): Promise<{
    outcome: SettingChangeOutcome;
    setting: SettingView;
    approvalRequestId: string | null;
  }> {
    const definition = definitionOf(key);
    if (!definition.isValid(input.value)) {
      throw invalidValue(key);
    }
    const now = clock.now();
    const reason = input.reason ?? null;
    const result = await runInTransaction(
      async (tx) => {
        await lockKey(tx, key);
        const previousValue = await currentValue(tx, key);
        if (JSON.stringify(previousValue) === JSON.stringify(input.value)) {
          return { outcome: "UNCHANGED" as const, approvalRequestId: null };
        }
        if (definition.critical) {
          // A second proposal while one is pending: 409 APPROVAL_PENDING.
          const request = await requestApproval(
            tx,
            {
              approvalType: "CRITICAL_SETTING",
              entityType: SETTING_ENTITY_TYPE,
              entityId: key,
              requestedByEmployeeId: employeeId,
              reason,
              metadata: { key, previousValue, newValue: input.value } as Prisma.InputJsonValue,
            },
            { now, correlationId },
          );
          return { outcome: "PENDING_APPROVAL" as const, approvalRequestId: request.id };
        }
        await applyChange(tx, {
          key,
          previousValue,
          newValue: input.value,
          changedByEmployeeId: employeeId,
          approvedByEmployeeId: null,
          actorEmployeeId: employeeId,
          reason,
          correlationId,
          now,
        });
        return { outcome: "APPLIED" as const, approvalRequestId: null };
      },
      {},
      db,
    );
    return { ...result, setting: await viewOf(key) };
  }

  /** Applied changes, newest first (`GET /admin/settings/history`). */
  async function listHistory(query: {
    page: number;
    pageSize: number;
    key?: string;
  }): Promise<{ items: SettingHistoryView[]; pagination: Pagination }> {
    const where = query.key ? { settingKey: query.key } : {};
    const [total, rows] = await Promise.all([
      db.settingHistory.count({ where }),
      db.settingHistory.findMany({
        where,
        include: { changedBy: person, approvedBy: person },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        key: row.settingKey,
        oldValue: row.oldValueJson,
        newValue: row.newValueJson,
        changedBy: row.changedBy,
        approvedBy: row.approvedBy,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  return { listSettings: () => listSettings(), changeSetting, listHistory };
}

export type SettingsService = ReturnType<typeof createSettingsService>;

let defaultService: SettingsService | undefined;

export function getSettingsService(): SettingsService {
  defaultService ??= createSettingsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
