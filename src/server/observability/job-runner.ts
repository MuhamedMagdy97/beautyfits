import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { logger as rootLogger, redactText, type Logger } from "@/server/logging/logger";
import { reportError } from "@/server/observability/report-error";
import { MS_PER_HOUR, MS_PER_MINUTE } from "@/server/time/time";

/**
 * Background job monitoring (TASK-065, ADR-0073).
 *
 * Every `npm run jobs:*` script runs through `runJob`, which records a
 * `job_runs` row (RUNNING → SUCCEEDED/FAILED with counts or the error) and
 * logs one structured line. The system status endpoint reads these rows.
 *
 * `maxIntervalMs` is the longest expected gap between two successful runs.
 * PROVISIONAL: schedules are set with deployment (TASK-066); these values
 * follow the cadence in each script's header comment.
 */
export const JOBS = {
  "dispatch-notifications": { maxIntervalMs: 30 * MS_PER_MINUTE },
  "deliver-campaigns": { maxIntervalMs: 30 * MS_PER_MINUTE },
  "expire-cod-orders": { maxIntervalMs: 30 * MS_PER_MINUTE },
  "send-cod-reminders": { maxIntervalMs: 30 * MS_PER_MINUTE },
  "notify-restocks": { maxIntervalMs: 30 * MS_PER_MINUTE },
  "record-checkout-abandonments": { maxIntervalMs: 3 * MS_PER_HOUR },
  "expire-guest-carts": { maxIntervalMs: 26 * MS_PER_HOUR },
  "send-wishlist-reminders": { maxIntervalMs: 26 * MS_PER_HOUR },
} as const satisfies Record<string, { maxIntervalMs: number }>;

export type JobName = keyof typeof JOBS;

export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** Stored error text is capped; the full (redacted) error is in the log line. */
const MAX_ERROR_LENGTH = 1_000;

export function describeJobError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactText(text).slice(0, MAX_ERROR_LENGTH);
}

/**
 * Runs one job and records it. Resolves to true on success; on failure the
 * error is reported and the promise resolves to false (it never rejects).
 */
export async function runJob(
  name: JobName,
  work: () => Promise<Record<string, number>>,
  deps: { db?: PrismaClient; logger?: Logger } = {},
): Promise<boolean> {
  const db = deps.db ?? getDb();
  const log = (deps.logger ?? rootLogger).child({ job: name });
  const startedAt = Date.now();
  let runId: string | undefined;
  try {
    ({ id: runId } = await db.jobRun.create({ data: { jobName: name }, select: { id: true } }));
    const counts = await work();
    await db.jobRun.update({
      where: { id: runId },
      data: { status: "SUCCEEDED", finishedAt: new Date(), counts },
    });
    log.info("Job succeeded", { counts, durationMs: Date.now() - startedAt });
    return true;
  } catch (error) {
    reportError(error, {
      msg: "Job failed",
      logger: log,
      fields: { durationMs: Date.now() - startedAt },
    });
    if (runId !== undefined) {
      await db.jobRun
        .update({
          where: { id: runId },
          data: { status: "FAILED", finishedAt: new Date(), error: describeJobError(error) },
        })
        .catch((recordError: unknown) =>
          log.error("Could not record the failed job run", { err: recordError }),
        );
    }
    return false;
  }
}

/**
 * Entry point for `scripts/*.ts`: runs the job, sets a failing exit code,
 * and closes the database connection. (tsx runs scripts as CommonJS, so the
 * scripts cannot use top-level await.)
 */
export function runJobScript(name: JobName, work: () => Promise<Record<string, number>>): void {
  void runJob(name, work)
    .then((succeeded) => {
      if (!succeeded) {
        process.exitCode = 1;
      }
    })
    .finally(() => getDb().$disconnect());
}
