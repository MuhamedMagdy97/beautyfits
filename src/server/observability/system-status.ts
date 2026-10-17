import { createHash, timingSafeEqual } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { JobRunStatus, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { Logger } from "@/server/logging/logger";
import { JOB_NAMES, JOBS, type JobName } from "@/server/observability/job-runner";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "@/server/time/time";

/**
 * System status for operators (TASK-065, ADR-0073): database, migrations,
 * outbox backlog, background jobs and notification delivery failures, plus
 * the alerts they raise. Reports counts and timestamps only, never customer
 * data or connection details.
 *
 * PROVISIONAL thresholds: chosen by engineering for a small shop, to be
 * tuned once production traffic is known (docs/operations/monitoring.md).
 */
export const STATUS_THRESHOLDS = {
  /** Oldest due outbox event older than this → OUTBOX_BACKLOG. */
  outboxMaxDueAgeMs: 15 * MS_PER_MINUTE,
  /** FAILED outbox events created within this window → OUTBOX_FAILED_EVENTS. */
  outboxFailedWindowMs: MS_PER_DAY,
  /** A run still RUNNING after this → JOB_STUCK. */
  jobStuckAfterMs: 30 * MS_PER_MINUTE,
  /** Delivery attempts are measured over this window. */
  notificationWindowMs: MS_PER_HOUR,
  /** Below this many attempts the failure rate is not evaluated. */
  notificationMinAttempts: 20,
  /** FAILED attempts / all attempts above this → NOTIFICATION_FAILURE_RATE. */
  notificationMaxFailureRate: 0.2,
} as const;

export type AlertCode =
  | "MIGRATIONS_PENDING"
  | "MIGRATION_FAILED"
  | "OUTBOX_BACKLOG"
  | "OUTBOX_FAILED_EVENTS"
  | "JOB_FAILED"
  | "JOB_STALE"
  | "JOB_STUCK"
  | "NOTIFICATION_FAILURE_RATE";

export interface Alert {
  code: AlertCode;
  job?: JobName;
}

export interface JobStatus {
  name: JobName;
  lastRunStatus: JobRunStatus | null;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastSucceededAt: Date | null;
  lastError: string | null;
}

export interface SystemSnapshot {
  migrations: { applied: number; pending: string[] | null; failed: string[] };
  outbox: { due: number; oldestDueAt: Date | null; failedRecently: number };
  jobs: JobStatus[];
  notifications: { attempts: number; failed: number };
}

export interface SystemStatus {
  status: "ok" | "degraded" | "down";
  checkedAt: Date;
  database: "up" | "down";
  migrations?: SystemSnapshot["migrations"];
  outbox?: { due: number; oldestDueAgeSeconds: number | null; failedRecently: number };
  jobs?: JobStatus[];
  notifications?: SystemSnapshot["notifications"] & {
    windowMinutes: number;
    failureRate: number | null;
  };
  alerts: Alert[];
}

export const MONITORING_TOKEN_HEADER = "x-monitoring-token";

/**
 * True when the request carries the configured monitoring token. Compared
 * as SHA-256 digests in constant time; an empty configured token never matches.
 */
export function hasMonitoringToken(headers: Headers, configured: string): boolean {
  const presented = headers.get(MONITORING_TOKEN_HEADER);
  if (configured === "" || presented === null) {
    return false;
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(configured));
}

/** The alerts raised by a snapshot (pure; unit-tested). */
export function evaluateAlerts(snapshot: SystemSnapshot, now: Date): Alert[] {
  const t = STATUS_THRESHOLDS;
  const ms = now.getTime();
  const alerts: Alert[] = [];
  if (snapshot.migrations.pending !== null && snapshot.migrations.pending.length > 0) {
    alerts.push({ code: "MIGRATIONS_PENDING" });
  }
  if (snapshot.migrations.failed.length > 0) {
    alerts.push({ code: "MIGRATION_FAILED" });
  }
  const { oldestDueAt } = snapshot.outbox;
  if (oldestDueAt !== null && ms - oldestDueAt.getTime() > t.outboxMaxDueAgeMs) {
    alerts.push({ code: "OUTBOX_BACKLOG" });
  }
  if (snapshot.outbox.failedRecently > 0) {
    alerts.push({ code: "OUTBOX_FAILED_EVENTS" });
  }
  for (const job of snapshot.jobs) {
    if (job.lastRunStatus === "FAILED") {
      alerts.push({ code: "JOB_FAILED", job: job.name });
    }
    if (
      job.lastRunStatus === "RUNNING" &&
      job.lastStartedAt !== null &&
      ms - job.lastStartedAt.getTime() > t.jobStuckAfterMs
    ) {
      alerts.push({ code: "JOB_STUCK", job: job.name });
    }
    if (
      job.lastSucceededAt === null ||
      ms - job.lastSucceededAt.getTime() > JOBS[job.name].maxIntervalMs
    ) {
      alerts.push({ code: "JOB_STALE", job: job.name });
    }
  }
  const { attempts, failed } = snapshot.notifications;
  if (attempts >= t.notificationMinAttempts && failed / attempts > t.notificationMaxFailureRate) {
    alerts.push({ code: "NOTIFICATION_FAILURE_RATE" });
  }
  return alerts;
}

/** Migration folder names shipped with the app; null when not deployed alongside it. */
async function localMigrations(): Promise<string[] | null> {
  try {
    const entries = await readdir(join(process.cwd(), "prisma", "migrations"), {
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return null;
  }
}

async function jobStatus(db: PrismaClient, name: JobName): Promise<JobStatus> {
  const [last, lastSuccess] = await Promise.all([
    db.jobRun.findFirst({ where: { jobName: name }, orderBy: { startedAt: "desc" } }),
    db.jobRun.findFirst({
      where: { jobName: name, status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  return {
    name,
    lastRunStatus: last?.status ?? null,
    lastStartedAt: last?.startedAt ?? null,
    lastFinishedAt: last?.finishedAt ?? null,
    lastSucceededAt: lastSuccess?.finishedAt ?? null,
    lastError: last?.status === "FAILED" ? last.error : null,
  };
}

export async function collectSnapshot(db: PrismaClient, now: Date): Promise<SystemSnapshot> {
  const t = STATUS_THRESHOLDS;
  const [migrationRows, folders, due, oldestDue, failedRecently, jobs, attempts, failed] =
    await Promise.all([
      db.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
        SELECT migration_name, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL`,
      localMigrations(),
      db.outboxEvent.count({
        where: { status: { in: ["PENDING", "PROCESSING"] }, availableAt: { lte: now } },
      }),
      db.outboxEvent.findFirst({
        where: { status: { in: ["PENDING", "PROCESSING"] }, availableAt: { lte: now } },
        orderBy: { availableAt: "asc" },
        select: { availableAt: true },
      }),
      db.outboxEvent.count({
        where: {
          status: "FAILED",
          createdAt: { gte: new Date(now.getTime() - t.outboxFailedWindowMs) },
        },
      }),
      Promise.all(JOB_NAMES.map((name) => jobStatus(db, name))),
      db.notificationDelivery.count({
        where: { createdAt: { gte: new Date(now.getTime() - t.notificationWindowMs) } },
      }),
      db.notificationDelivery.count({
        where: {
          status: "FAILED",
          createdAt: { gte: new Date(now.getTime() - t.notificationWindowMs) },
        },
      }),
    ]);
  const applied = migrationRows.filter((row) => row.finished_at !== null);
  const appliedNames = new Set(applied.map((row) => row.migration_name));
  return {
    migrations: {
      applied: applied.length,
      pending: folders === null ? null : folders.filter((name) => !appliedNames.has(name)).sort(),
      failed: migrationRows.filter((row) => row.finished_at === null).map((r) => r.migration_name),
    },
    outbox: { due, oldestDueAt: oldestDue?.availableAt ?? null, failedRecently },
    jobs,
    notifications: { attempts, failed },
  };
}

export async function getSystemStatus(deps: {
  db?: PrismaClient;
  logger: Logger;
  now?: Date;
}): Promise<SystemStatus> {
  const now = deps.now ?? new Date();
  let snapshot: SystemSnapshot;
  try {
    snapshot = await collectSnapshot(deps.db ?? getDb(), now);
  } catch (error) {
    deps.logger.warn("System status: database unavailable", { err: error });
    return { status: "down", checkedAt: now, database: "down", alerts: [] };
  }
  const alerts = evaluateAlerts(snapshot, now);
  const { attempts, failed } = snapshot.notifications;
  const { oldestDueAt } = snapshot.outbox;
  return {
    status: alerts.length === 0 ? "ok" : "degraded",
    checkedAt: now,
    database: "up",
    migrations: snapshot.migrations,
    outbox: {
      due: snapshot.outbox.due,
      oldestDueAgeSeconds:
        oldestDueAt === null
          ? null
          : Math.floor((now.getTime() - oldestDueAt.getTime()) / MS_PER_SECOND),
      failedRecently: snapshot.outbox.failedRecently,
    },
    jobs: snapshot.jobs,
    notifications: {
      windowMinutes: STATUS_THRESHOLDS.notificationWindowMs / MS_PER_MINUTE,
      attempts,
      failed,
      failureRate: attempts === 0 ? null : failed / attempts,
    },
    alerts,
  };
}
