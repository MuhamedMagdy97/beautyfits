import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import type { EmailSender } from "@/server/email/email";
import { createLogger } from "@/server/logging/logger";
import { createAuditLogService, recordAudit, SYSTEM_ACTOR } from "@/server/modules/audit/audit";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { effectivePermissions } from "@/server/modules/rbac/authorization";
import {
  createEmployeeManagementService,
  type StaffActor,
} from "@/server/modules/rbac/employees-service";
import { createRolesService } from "@/server/modules/rbac/roles-service";
import { resetDatabase } from "@/test/integration/database";

/**
 * Audit logs (TASK-013, ADR-0018): append-only storage, the search, and the
 * entries written by role and staff changes (TASK-012).
 */

const db = getDb();
const START = new Date("2026-10-01T10:00:00.000Z").getTime();
let nowMs = START;
const clock = { now: () => new Date(nowMs) };
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 });
const mailed: string[] = [];
const email: EmailSender = {
  async send(message) {
    mailed.push(message.text);
  },
};
const logger = createLogger({ level: "error", write: () => {} });

const audit = createAuditLogService({ db });
const roles = createRolesService({ db, clock });
const employees = createEmployeeManagementService({
  db,
  clock,
  hasher,
  email,
  dashboardUrl: () => "https://dash.beautyfits.example",
});

const PASSWORD = "copper kite above the delta";
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
  const employee = account.employee!;
  const actor: StaffActor = {
    employeeId: employee.id,
    accountId: account.id,
    level,
    permissions: await effectivePermissions(db, employee),
  };
  return { employee, actor };
}

function entry(entityId: string, createdAt = new Date(nowMs)) {
  return {
    actor: SYSTEM_ACTOR,
    action: "ROLE_SEEDED" as const,
    entityType: "ROLE",
    entityId,
    next: { name: entityId },
    createdAt,
  };
}

beforeEach(async () => {
  await resetDatabase();
  nowMs = START;
  mailed.length = 0;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("audit_logs storage", () => {
  it("rejects every update and delete, whatever the client", async () => {
    await recordAudit(db, entry("r1"));
    const row = await db.auditLog.findFirstOrThrow();

    await expect(
      db.auditLog.update({ where: { id: row.id }, data: { reason: "edited" } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRaw`UPDATE audit_logs SET action = 'X' WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow(/append-only/);

    const after = await db.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toEqual(row);
  });

  it("keeps no entry when the change it describes rolls back", async () => {
    await expect(
      runInTransaction(
        async (tx) => {
          await recordAudit(tx, entry("r1"));
          throw new Error("change failed");
        },
        {},
        db,
      ),
    ).rejects.toThrow("change failed");
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe("listAuditLogs", () => {
  it("filters by actor, action, entity and time, newest first", async () => {
    const { employee } = await createStaff("OWNER");
    await recordAudit(db, entry("r1", new Date(START)));
    await recordAudit(db, entry("r2", new Date(START + 1000)));
    await recordAudit(db, {
      actor: { type: "EMPLOYEE", id: employee.id },
      action: "ROLE_UPDATED",
      entityType: "ROLE",
      entityId: "r1",
      previous: { name: "r1" },
      next: { name: "R1" },
      correlationId: "req-9",
      createdAt: new Date(START + 2000),
    });

    const all = await audit.listAuditLogs({ page: 1, pageSize: 2 });
    expect(all.items.map((i) => i.action)).toEqual(["ROLE_UPDATED", "ROLE_SEEDED"]);
    expect(all.items[0]).toMatchObject({
      actor: { type: "EMPLOYEE", id: employee.id, displayName: employee.displayName },
      entityType: "ROLE",
      entityId: "r1",
      previousData: { name: "r1" },
      newData: { name: "R1" },
      correlationId: "req-9",
      createdAt: new Date(START + 2000).toISOString(),
    });
    expect(all.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const system = await audit.listAuditLogs({ page: 1, pageSize: 10, actorType: "SYSTEM" });
    expect(system.items).toHaveLength(2);
    expect(system.items[0].actor).toEqual({ type: "SYSTEM", id: null, displayName: null });

    const byEntity = await audit.listAuditLogs({
      page: 1,
      pageSize: 10,
      entityType: "ROLE",
      entityId: "r1",
    });
    expect(byEntity.items).toHaveLength(2);

    const byActor = await audit.listAuditLogs({ page: 1, pageSize: 10, actorId: employee.id });
    expect(byActor.items.map((i) => i.action)).toEqual(["ROLE_UPDATED"]);

    const window = await audit.listAuditLogs({
      page: 1,
      pageSize: 10,
      from: new Date(START + 1000),
      to: new Date(START + 2000),
    });
    expect(window.items.map((i) => i.entityId)).toEqual(["r2"]);

    const byAction = await audit.listAuditLogs({ page: 1, pageSize: 10, action: "ROLE_SEEDED" });
    expect(byAction.pagination.total).toBe(2);
  });
});

describe("role and staff changes are audited (TASK-012)", () => {
  it("records role creation and edits with before and after", async () => {
    const { actor } = await createStaff("OWNER");
    const role = await roles.createRole(
      actor,
      { name: "Packers", permissions: ["ORDERS_VIEW"] },
      logger,
      "req-1",
    );
    await roles.updateRole(
      actor,
      role.id,
      { name: "Pickers", permissions: ["ORDERS_VIEW", "START_PREPARING"] },
      logger,
      "req-2",
    );

    const rows = await db.auditLog.findMany({
      where: { entityId: role.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.action)).toEqual(["ROLE_CREATED", "ROLE_UPDATED"]);
    expect(rows[0]).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: actor.employeeId,
      entityType: "ROLE",
      correlationId: "req-1",
      newDataJson: { name: "Packers", description: null, permissions: ["ORDERS_VIEW"] },
    });
    expect(rows[1]).toMatchObject({
      correlationId: "req-2",
      previousDataJson: { name: "Packers", permissions: ["ORDERS_VIEW"] },
      newDataJson: { name: "Pickers", permissions: ["ORDERS_VIEW", "START_PREPARING"] },
    });
  });

  it("records an invitation, its acceptance, an edit and a deactivation", async () => {
    const { actor } = await createStaff("OWNER");
    const role = await roles.createRole(actor, { name: "Packers", permissions: [] }, logger);
    const { invitation } = await employees.invite(
      actor,
      {
        email: "sara@beautyfits.example",
        displayName: "Sara Adel",
        level: "EMPLOYEE",
        roleIds: [role.id],
      },
      { ip: null, userAgent: null, logger, requestId: "req-invite" },
    );
    const invited = await db.auditLog.findFirstOrThrow({ where: { action: "EMPLOYEE_INVITED" } });
    expect(invited).toMatchObject({
      actorId: actor.employeeId,
      entityType: "EMPLOYEE_INVITATION",
      entityId: invitation.id,
      correlationId: "req-invite",
      newDataJson: {
        email: "sara@beautyfits.example",
        level: "EMPLOYEE",
        roleIds: [role.id],
      },
    });

    const token = /#token=(bfi_[A-Za-z0-9_-]+)/.exec(mailed[0])![1];
    const accepted = await employees.acceptInvitation(
      { invitationToken: token, password: PASSWORD },
      { ip: null, userAgent: null, logger, requestId: "req-accept" },
    );
    const employeeId = accepted.employee.id;
    const acceptance = await db.auditLog.findFirstOrThrow({
      where: { action: "EMPLOYEE_INVITATION_ACCEPTED" },
    });
    expect(acceptance).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: employeeId,
      entityType: "EMPLOYEE",
      entityId: employeeId,
      correlationId: "req-accept",
      newDataJson: {
        invitationId: invitation.id,
        invitedByEmployeeId: actor.employeeId,
        level: "EMPLOYEE",
        roleIds: [role.id],
      },
    });

    nowMs += 1000;
    // An edit that changes nothing is not recorded.
    await employees.updateEmployee(actor, employeeId, { displayName: "Sara Adel" }, logger);
    await employees.updateEmployee(
      actor,
      employeeId,
      { level: "MANAGER", roleIds: [] },
      logger,
      "req-edit",
    );
    nowMs += 1000;
    await employees.deactivateEmployee(actor, employeeId, logger, "req-off");
    // Deactivating again changes nothing and is not recorded.
    await employees.deactivateEmployee(actor, employeeId, logger);

    const history = await db.auditLog.findMany({
      where: { entityType: "EMPLOYEE", entityId: employeeId },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => h.action)).toEqual([
      "EMPLOYEE_INVITATION_ACCEPTED",
      "EMPLOYEE_UPDATED",
      "EMPLOYEE_DEACTIVATED",
    ]);
    expect(history[1]).toMatchObject({
      correlationId: "req-edit",
      previousDataJson: { level: "EMPLOYEE", roleIds: [role.id] },
      newDataJson: { level: "MANAGER", roleIds: [] },
    });
    expect(history[2]).toMatchObject({
      correlationId: "req-off",
      previousDataJson: { status: "ACTIVE" },
      newDataJson: { status: "DEACTIVATED" },
    });

    // No secrets in any entry.
    const everything = JSON.stringify(await db.auditLog.findMany());
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toMatch(/scrypt|passwordHash|tokenHash/);
  });

  it("records a revoked invitation", async () => {
    const { actor } = await createStaff("ADMIN");
    const { invitation } = await employees.invite(
      actor,
      { email: "omar@beautyfits.example", displayName: "Omar", level: "EMPLOYEE", roleIds: [] },
      { ip: null, userAgent: null, logger },
    );
    await employees.revokeInvitation(actor, invitation.id, logger, "req-revoke");
    const revoked = await db.auditLog.findFirstOrThrow({
      where: { action: "EMPLOYEE_INVITATION_REVOKED" },
    });
    expect(revoked).toMatchObject({
      entityId: invitation.id,
      actorId: actor.employeeId,
      correlationId: "req-revoke",
      previousDataJson: { status: "PENDING" },
      newDataJson: { status: "REVOKED" },
    });
  });

  it("records nothing for a refused change", async () => {
    const { actor } = await createStaff("ADMIN");
    const owner = await createStaff("OWNER");
    await expect(
      employees.deactivateEmployee(actor, owner.employee.id, logger),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await db.auditLog.count()).toBe(0);
  });
});
