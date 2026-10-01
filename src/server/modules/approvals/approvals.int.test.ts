import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { AppError, type ErrorCode } from "@/server/errors/app-error";
import {
  cancelApprovalRequest,
  createApprovalService,
  findPendingApproval,
  requestApproval,
  type ApprovalHandler,
} from "@/server/modules/approvals/approvals";
import { resetDatabase } from "@/test/integration/database";

/** Approval requests (TASK-013, ADR-0018) against the test database. */

const db = getDb();
const START = new Date("2026-10-01T10:00:00.000Z").getTime();
let nowMs = START;
const clock = { now: () => new Date(nowMs) };

/** A stand-in feature: approving sets a setting row, rejecting records it. */
const applied: string[] = [];
const handler: ApprovalHandler = {
  async onApproved(tx, request) {
    const metadata = request.metadataJson as { value: number };
    await tx.setting.upsert({
      where: { key: request.entityId },
      create: { key: request.entityId, valueJson: metadata.value, dataType: "INTEGER" },
      update: { valueJson: metadata.value },
    });
    applied.push(`approved:${request.id}`);
  },
  async onRejected(_tx, request) {
    applied.push(`rejected:${request.id}`);
  },
};
const service = createApprovalService({ db, clock, handlers: { CRITICAL_SETTING: handler } });

let counter = 0;

async function createStaff(level: EmployeeLevel) {
  counter += 1;
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `staff${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(nowMs),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: { create: { displayName: `Staff ${counter}`, employeeLevel: level } },
    },
    include: { employee: true },
  });
  return account.employee!;
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  return expect.unreachable(`expected ${code}`);
}

function open(
  requestedByEmployeeId: string,
  options: { key?: string; value?: number; reason?: string } = {},
) {
  return runInTransaction(
    (tx) =>
      requestApproval(
        tx,
        {
          approvalType: "CRITICAL_SETTING",
          entityType: "SETTING",
          entityId: options.key ?? "returns.window_days",
          requestedByEmployeeId,
          reason: options.reason ?? "Align with the new policy",
          metadata: { value: options.value ?? 21 },
        },
        { now: clock.now(), correlationId: "req-1" },
      ),
    {},
    db,
  );
}

async function audits(entityId: string) {
  return db.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });
}

beforeEach(async () => {
  await resetDatabase();
  nowMs = START;
  applied.length = 0;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("requestApproval", () => {
  it("opens a PENDING request and audits it in the same transaction", async () => {
    const manager = await createStaff("MANAGER");
    const request = await open(manager.id);
    expect(request).toMatchObject({
      status: "PENDING",
      approvalType: "CRITICAL_SETTING",
      entityType: "SETTING",
      entityId: "returns.window_days",
      requestedByEmployeeId: manager.id,
      reason: "Align with the new policy",
      resolvedAt: null,
    });
    const [entry] = await audits(request.id);
    expect(entry).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: manager.id,
      action: "APPROVAL_REQUESTED",
      entityType: "APPROVAL_REQUEST",
      reason: "Align with the new policy",
      correlationId: "req-1",
    });
    expect(entry.newDataJson).toMatchObject({ status: "PENDING", metadata: { value: 21 } });
  });

  it("allows one PENDING request per type and entity", async () => {
    const manager = await createStaff("MANAGER");
    const first = await open(manager.id);
    const error = await expectCode(open(manager.id), "CONFLICT");
    expect(error.details).toMatchObject({
      reason: "APPROVAL_PENDING",
      approvalRequestId: first.id,
    });
    // Another entity is fine.
    await open(manager.id, { key: "shipping.free_threshold" });
  });

  it("lets only one of two concurrent requests for the same entity through", async () => {
    const manager = await createStaff("MANAGER");
    const results = await Promise.allSettled([open(manager.id), open(manager.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.approvalRequest.count()).toBe(1);
  });

  it("rolls back with the feature's transaction", async () => {
    const manager = await createStaff("MANAGER");
    await expect(
      runInTransaction(
        async (tx) => {
          await requestApproval(
            tx,
            {
              approvalType: "CRITICAL_SETTING",
              entityType: "SETTING",
              entityId: "x",
              requestedByEmployeeId: manager.id,
            },
            { now: clock.now() },
          );
          throw new Error("feature failed");
        },
        {},
        db,
      ),
    ).rejects.toThrow("feature failed");
    expect(await db.approvalRequest.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe("approve", () => {
  it("applies the action, records the resolver and audits it", async () => {
    const manager = await createStaff("MANAGER");
    const admin = await createStaff("ADMIN");
    const request = await open(manager.id, { value: 30 });
    nowMs += 60_000;

    const view = await service.approve(admin.id, request.id, { reason: "OK" }, "req-2");
    expect(view).toMatchObject({
      status: "APPROVED",
      requestedBy: { id: manager.id, displayName: manager.displayName },
      resolvedBy: { id: admin.id, displayName: admin.displayName },
      resolvedAt: new Date(nowMs).toISOString(),
      resolutionReason: "OK",
      metadata: { value: 30 },
    });
    expect(applied).toEqual([`approved:${request.id}`]);
    const setting = await db.setting.findUniqueOrThrow({ where: { key: "returns.window_days" } });
    expect(setting.valueJson).toBe(30);

    const entries = await audits(request.id);
    expect(entries.map((e) => e.action)).toEqual(["APPROVAL_REQUESTED", "APPROVAL_APPROVED"]);
    expect(entries[1]).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: admin.id,
      reason: "OK",
      correlationId: "req-2",
      previousDataJson: { status: "PENDING" },
    });
    expect(
      await findPendingApproval(db, "CRITICAL_SETTING", "SETTING", "returns.window_days"),
    ).toBe(null);
  });

  it("refuses a request that is no longer pending", async () => {
    const manager = await createStaff("MANAGER");
    const owner = await createStaff("OWNER");
    const request = await open(manager.id);
    await service.approve(owner.id, request.id, {});
    const error = await expectCode(service.approve(owner.id, request.id, {}), "CONFLICT");
    expect(error.details).toMatchObject({ reason: "APPROVAL_NOT_PENDING", status: "APPROVED" });
    await expectCode(service.reject(owner.id, request.id, { reason: "No" }), "CONFLICT");
    expect(applied).toHaveLength(1);
  });

  it("does not let anyone resolve their own request", async () => {
    const admin = await createStaff("ADMIN");
    const request = await open(admin.id);
    const error = await expectCode(service.approve(admin.id, request.id, {}), "PERMISSION_DENIED");
    expect(error.details).toMatchObject({ reason: "SELF_APPROVAL" });
    await expectCode(service.reject(admin.id, request.id, { reason: "x" }), "PERMISSION_DENIED");
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      "PENDING",
    );
  });

  it("leaves the request pending when the feature refuses the action", async () => {
    const manager = await createStaff("MANAGER");
    const owner = await createStaff("OWNER");
    const request = await open(manager.id);
    const refusing = createApprovalService({
      db,
      clock,
      handlers: {
        CRITICAL_SETTING: {
          async onApproved() {
            throw new AppError("CONFLICT", "The setting changed since the request.");
          },
        },
      },
    });
    await expectCode(refusing.approve(owner.id, request.id, {}), "CONFLICT");
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      "PENDING",
    );
    expect((await audits(request.id)).map((e) => e.action)).toEqual(["APPROVAL_REQUESTED"]);
  });

  it("fails for a type whose feature has no handler yet", async () => {
    const manager = await createStaff("MANAGER");
    const owner = await createStaff("OWNER");
    const request = await open(manager.id);
    const bare = createApprovalService({ db, clock, handlers: {} });
    await expect(bare.approve(owner.id, request.id, {})).rejects.toThrow(/No approval handler/);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      "PENDING",
    );
    // Rejecting needs no handler.
    const rejected = await bare.reject(owner.id, request.id, { reason: "Not now" });
    expect(rejected.status).toBe("REJECTED");
  });

  it("resolves a request once when two resolutions race", async () => {
    const manager = await createStaff("MANAGER");
    const owner = await createStaff("OWNER");
    const admin = await createStaff("ADMIN");
    const request = await open(manager.id);
    const results = await Promise.allSettled([
      service.approve(owner.id, request.id, {}),
      service.reject(admin.id, request.id, { reason: "No" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(applied).toHaveLength(1);
    expect((await audits(request.id)).map((e) => e.action)).toHaveLength(2);
  });

  it("answers 404 for an unknown request", async () => {
    const owner = await createStaff("OWNER");
    await expectCode(
      service.approve(owner.id, "019a0000-0000-7000-8000-000000000000", {}),
      "NOT_FOUND",
    );
  });
});

describe("reject", () => {
  it("stores the reason, calls the feature and audits it", async () => {
    const manager = await createStaff("MANAGER");
    const owner = await createStaff("OWNER");
    const request = await open(manager.id);
    const view = await service.reject(owner.id, request.id, { reason: "Too long" }, "req-3");
    expect(view).toMatchObject({ status: "REJECTED", resolutionReason: "Too long" });
    expect(applied).toEqual([`rejected:${request.id}`]);
    expect(await db.setting.count()).toBe(0);
    const [, entry] = await audits(request.id);
    expect(entry).toMatchObject({
      action: "APPROVAL_REJECTED",
      actorId: owner.id,
      reason: "Too long",
      correlationId: "req-3",
    });
    // A new request for the same entity can be opened afterwards.
    await open(manager.id);
  });
});

describe("cancelApprovalRequest", () => {
  it("withdraws a pending request once and audits it", async () => {
    const manager = await createStaff("MANAGER");
    const request = await open(manager.id);
    const cancel = () =>
      runInTransaction(
        (tx) =>
          cancelApprovalRequest(
            tx,
            {
              approvalRequestId: request.id,
              actor: { type: "EMPLOYEE", id: manager.id },
              reason: "Draft withdrawn",
            },
            { now: clock.now() },
          ),
        {},
        db,
      );
    const cancelled = await cancel();
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      resolvedByEmployeeId: manager.id,
      resolutionReason: "Draft withdrawn",
    });
    expect(await cancel()).toBeNull();
    expect((await audits(request.id)).map((e) => e.action)).toEqual([
      "APPROVAL_REQUESTED",
      "APPROVAL_CANCELLED",
    ]);
  });
});

describe("listApprovalRequests", () => {
  it("filters and paginates, newest first", async () => {
    const manager = await createStaff("MANAGER");
    const owner = await createStaff("OWNER");
    const a = await open(manager.id, { key: "a" });
    nowMs += 1000;
    const b = await open(manager.id, { key: "b" });
    nowMs += 1000;
    const c = await open(manager.id, { key: "c" });
    await service.reject(owner.id, b.id, { reason: "No" });

    const all = await service.listApprovalRequests({ page: 1, pageSize: 2 });
    expect(all.items.map((r) => r.id)).toEqual([c.id, b.id]);
    expect(all.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const pending = await service.listApprovalRequests({
      page: 1,
      pageSize: 10,
      status: "PENDING",
    });
    expect(pending.items.map((r) => r.id)).toEqual([c.id, a.id]);

    const forEntity = await service.listApprovalRequests({
      page: 1,
      pageSize: 10,
      entityType: "SETTING",
      entityId: "a",
    });
    expect(forEntity.items.map((r) => r.id)).toEqual([a.id]);

    const detail = await service.getApprovalRequest(b.id);
    expect(detail).toMatchObject({ status: "REJECTED", resolvedBy: { id: owner.id } });
    await expectCode(
      service.getApprovalRequest("019a0000-0000-7000-8000-000000000000"),
      "NOT_FOUND",
    );
  });
});
