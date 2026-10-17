import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as systemStatus } from "@/app/api/v1/admin/system-status/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createLogger } from "@/server/logging/logger";
import { createSession } from "@/server/modules/auth/sessions";
import { JOB_NAMES, runJob } from "@/server/observability/job-runner";
import { MS_PER_HOUR, MS_PER_MINUTE } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/**
 * Job run recording and GET /api/v1/admin/system-status (TASK-065, ADR-0073).
 */

const MONITORING_TOKEN = vi.hoisted(() => {
  const token = "t".repeat(40);
  process.env.MONITORING_TOKEN = token;
  return token;
});

const db = getDb();
const quietLogger = createLogger({ write: () => {} });
const AGGREGATE_ID = "019a0000-0000-7000-8000-000000000001";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(headers: Record<string, string> = {}) {
  const response = await (systemStatus as Handler)(
    new Request("http://localhost/api/v1/admin/system-status", { headers }),
    { params: Promise.resolve({}) as Promise<never> },
  );
  return { status: response.status, body: await response.json() };
}

let counter = 0;

async function staffToken(level: EmployeeLevel): Promise<string> {
  counter += 1;
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `ops${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: { create: { displayName: `Ops ${counter}`, employeeLevel: level } },
    },
  });
  const created = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return created.tokens.accessToken;
}

async function allJobsSucceeded() {
  for (const name of JOB_NAMES) {
    await runJob(name, async () => ({ processed: 0 }), { db, logger: quietLogger });
  }
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("runJob", () => {
  it("records a successful run with its counts", async () => {
    expect(
      await runJob("expire-cod-orders", async () => ({ ordersExpired: 2 }), {
        db,
        logger: quietLogger,
      }),
    ).toBe(true);
    const [run] = await db.jobRun.findMany();
    expect(run).toMatchObject({
      jobName: "expire-cod-orders",
      status: "SUCCEEDED",
      counts: { ordersExpired: 2 },
      error: null,
    });
    expect(run.finishedAt).not.toBeNull();
  });

  it("records a failed run with a redacted error, and never rejects", async () => {
    const failed = await runJob(
      "dispatch-notifications",
      async () => {
        throw new Error("connect postgres://app:hunter2@db/x failed");
      },
      { db, logger: quietLogger },
    );
    expect(failed).toBe(false);
    const [run] = await db.jobRun.findMany();
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("Error: connect postgres://app:[REDACTED]@db/x failed");
  });
});

describe("GET /admin/system-status", () => {
  it("requires a session with VIEW_AUDIT_LOGS, or the monitoring token", async () => {
    expect((await call()).status).toBe(401);
    expect((await call({ "x-monitoring-token": "wrong" })).status).toBe(401);
    const manager = await staffToken("MANAGER");
    expect((await call({ authorization: `Bearer ${manager}` })).status).toBe(403);

    await allJobsSucceeded();
    const admin = await staffToken("ADMIN");
    expect((await call({ authorization: `Bearer ${admin}` })).status).toBe(200);
    expect((await call({ "x-monitoring-token": MONITORING_TOKEN })).status).toBe(200);
  });

  it("is ok when every job ran and nothing is backed up", async () => {
    await allJobsSucceeded();
    const { status, body } = await call({ "x-monitoring-token": MONITORING_TOKEN });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      status: "ok",
      database: "up",
      migrations: { pending: [], failed: [] },
      outbox: { due: 0, oldestDueAgeSeconds: null, failedRecently: 0 },
      notifications: { attempts: 0, failed: 0, failureRate: null },
      alerts: [],
    });
    expect(body.data.migrations.applied).toBeGreaterThan(0);
    expect(body.data.jobs).toHaveLength(JOB_NAMES.length);
  });

  it("is degraded (503) with alerts for backlog, failures and missing jobs", async () => {
    await allJobsSucceeded();
    await runJob(
      "deliver-campaigns",
      async () => {
        throw new Error("provider down");
      },
      { db, logger: quietLogger },
    );
    await db.jobRun.deleteMany({ where: { jobName: "expire-guest-carts" } });
    const old = new Date(Date.now() - 20 * MS_PER_MINUTE);
    await db.outboxEvent.createMany({
      data: [
        {
          eventType: "x",
          aggregateType: "ORDER",
          aggregateId: AGGREGATE_ID,
          payload: {},
          availableAt: old,
        },
        {
          eventType: "x",
          aggregateType: "ORDER",
          aggregateId: AGGREGATE_ID,
          payload: {},
          status: "FAILED",
        },
      ],
    });
    await db.notificationDelivery.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        templateKey: "t",
        locale: "ar" as const,
        channel: "WHATSAPP" as const,
        recipient: "x",
        attemptNumber: 1,
        status: i < 10 ? ("FAILED" as const) : ("SENT" as const),
        createdAt: new Date(),
        sentAt: i < 10 ? null : new Date(),
      })),
    });

    const { status, body } = await call({ "x-monitoring-token": MONITORING_TOKEN });
    expect(status).toBe(503);
    expect(body.data.status).toBe("degraded");
    expect(body.data.alerts).toEqual(
      expect.arrayContaining([
        { code: "OUTBOX_BACKLOG" },
        { code: "OUTBOX_FAILED_EVENTS" },
        { code: "JOB_FAILED", job: "deliver-campaigns" },
        { code: "JOB_STALE", job: "expire-guest-carts" },
        { code: "NOTIFICATION_FAILURE_RATE" },
      ]),
    );
    expect(body.data.alerts).toHaveLength(5);
    expect(body.data.notifications.failureRate).toBe(0.5);
    const campaigns = body.data.jobs.find(
      (job: { name: string }) => job.name === "deliver-campaigns",
    );
    expect(campaigns).toMatchObject({ lastRunStatus: "FAILED", lastError: "Error: provider down" });
  });
});
