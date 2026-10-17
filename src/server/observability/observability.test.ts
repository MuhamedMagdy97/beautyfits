import { afterEach, describe, expect, it } from "vitest";
import { createLogger, type LogLevel } from "@/server/logging/logger";
import { describeJobError, JOB_NAMES, type JobName } from "@/server/observability/job-runner";
import { reportError, setErrorReporter } from "@/server/observability/report-error";
import {
  evaluateAlerts,
  hasMonitoringToken,
  STATUS_THRESHOLDS,
  type JobStatus,
  type SystemSnapshot,
} from "@/server/observability/system-status";
import { MS_PER_HOUR, MS_PER_MINUTE } from "@/server/time/time";

const NOW = new Date("2026-10-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function healthyJob(name: JobName): JobStatus {
  return {
    name,
    lastRunStatus: "SUCCEEDED",
    lastStartedAt: ago(MS_PER_MINUTE),
    lastFinishedAt: ago(MS_PER_MINUTE),
    lastSucceededAt: ago(MS_PER_MINUTE),
    lastError: null,
  };
}

function snapshot(overrides: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    migrations: { applied: 3, pending: [], failed: [] },
    outbox: { due: 0, oldestDueAt: null, failedRecently: 0 },
    jobs: JOB_NAMES.map(healthyJob),
    notifications: { attempts: 0, failed: 0 },
    ...overrides,
  };
}

function withJob(job: Partial<JobStatus> & { name: JobName }): JobStatus[] {
  return JOB_NAMES.map((name) =>
    name === job.name ? { ...healthyJob(name), ...job } : healthyJob(name),
  );
}

describe("evaluateAlerts", () => {
  it("raises nothing for a healthy system", () => {
    expect(evaluateAlerts(snapshot(), NOW)).toEqual([]);
  });

  it("flags pending and failed migrations, but not an unknown migration list", () => {
    expect(
      evaluateAlerts(snapshot({ migrations: { applied: 1, pending: ["x"], failed: ["y"] } }), NOW),
    ).toEqual([{ code: "MIGRATIONS_PENDING" }, { code: "MIGRATION_FAILED" }]);
    expect(
      evaluateAlerts(snapshot({ migrations: { applied: 1, pending: null, failed: [] } }), NOW),
    ).toEqual([]);
  });

  it("flags an outbox backlog only past the threshold, and recent failed events", () => {
    const limit = STATUS_THRESHOLDS.outboxMaxDueAgeMs;
    const at = (oldestDueAt: Date, failedRecently = 0) =>
      evaluateAlerts(snapshot({ outbox: { due: 1, oldestDueAt, failedRecently } }), NOW);
    expect(at(ago(limit))).toEqual([]);
    expect(at(ago(limit + 1))).toEqual([{ code: "OUTBOX_BACKLOG" }]);
    expect(at(ago(0), 2)).toEqual([{ code: "OUTBOX_FAILED_EVENTS" }]);
  });

  it("flags failed, stuck, stale and never-run jobs", () => {
    expect(
      evaluateAlerts(
        snapshot({ jobs: withJob({ name: "expire-cod-orders", lastRunStatus: "FAILED" }) }),
        NOW,
      ),
    ).toEqual([{ code: "JOB_FAILED", job: "expire-cod-orders" }]);

    expect(
      evaluateAlerts(
        snapshot({
          jobs: withJob({
            name: "expire-guest-carts",
            lastRunStatus: "RUNNING",
            lastStartedAt: ago(STATUS_THRESHOLDS.jobStuckAfterMs + 1),
          }),
        }),
        NOW,
      ),
    ).toEqual([{ code: "JOB_STUCK", job: "expire-guest-carts" }]);

    // Daily job: 25 h without success is fine, 27 h is stale.
    const daily = (hours: number) =>
      evaluateAlerts(
        snapshot({
          jobs: withJob({
            name: "send-wishlist-reminders",
            lastSucceededAt: ago(hours * MS_PER_HOUR),
          }),
        }),
        NOW,
      );
    expect(daily(25)).toEqual([]);
    expect(daily(27)).toEqual([{ code: "JOB_STALE", job: "send-wishlist-reminders" }]);

    expect(
      evaluateAlerts(
        snapshot({
          jobs: withJob({
            name: "deliver-campaigns",
            lastRunStatus: null,
            lastStartedAt: null,
            lastSucceededAt: null,
          }),
        }),
        NOW,
      ),
    ).toEqual([{ code: "JOB_STALE", job: "deliver-campaigns" }]);
  });

  it("flags a notification failure rate above the threshold with enough attempts", () => {
    const rate = (attempts: number, failed: number) =>
      evaluateAlerts(snapshot({ notifications: { attempts, failed } }), NOW);
    expect(rate(10, 10)).toEqual([]); // too few attempts
    expect(rate(20, 4)).toEqual([]); // exactly 20 %
    expect(rate(20, 5)).toEqual([{ code: "NOTIFICATION_FAILURE_RATE" }]);
  });
});

describe("hasMonitoringToken", () => {
  const token = "m".repeat(32);
  const headers = (value?: string) =>
    new Headers(value === undefined ? {} : { "x-monitoring-token": value });

  it("matches only the configured token", () => {
    expect(hasMonitoringToken(headers(token), token)).toBe(true);
    expect(hasMonitoringToken(headers(`${token}x`), token)).toBe(false);
    expect(hasMonitoringToken(headers(), token)).toBe(false);
  });

  it("never matches when no token is configured", () => {
    expect(hasMonitoringToken(headers(""), "")).toBe(false);
  });
});

describe("reportError", () => {
  afterEach(() => setErrorReporter(null));

  function capture() {
    const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
    const logger = createLogger({
      write: (level, line) => lines.push({ level, entry: JSON.parse(line) }),
    });
    return { lines, logger };
  }

  it("logs a redacted error line by default", () => {
    const { lines, logger } = capture();
    reportError(new Error("db failed: postgres://u:secretpw@db/x"), {
      msg: "Boom",
      logger,
      fields: { path: "/x" },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("error");
    expect(lines[0].entry).toMatchObject({ msg: "Boom", path: "/x" });
    expect(JSON.stringify(lines[0].entry)).not.toContain("secretpw");
  });

  it("uses an attached reporter, and falls back to the log when it throws", () => {
    const { lines, logger } = capture();
    const seen: unknown[] = [];
    setErrorReporter((error) => seen.push(error));
    const error = new Error("x");
    reportError(error, { msg: "Boom", logger });
    expect(seen).toEqual([error]);
    expect(lines).toHaveLength(0);

    setErrorReporter(() => {
      throw new Error("vendor down");
    });
    expect(() => reportError(error, { msg: "Boom", logger })).not.toThrow();
    expect(lines.map((line) => line.entry.msg)).toEqual(["Boom"]);
  });
});

describe("describeJobError", () => {
  it("keeps the name and redacted message, capped", () => {
    expect(describeJobError(new TypeError("token=abc123 bad"))).toBe(
      "TypeError: token=[REDACTED] bad",
    );
    expect(describeJobError(new Error("x".repeat(5_000)))).toHaveLength(1_000);
  });
});
