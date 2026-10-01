import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { EmailMessage, EmailSender } from "@/server/email/email";
import { AppError, type ErrorCode } from "@/server/errors/app-error";
import { createLogger } from "@/server/logging/logger";
import type { RequestMeta } from "@/server/modules/auth/auth-service";
import { createEmployeeAuthService } from "@/server/modules/auth/employee-auth-service";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { createSession } from "@/server/modules/auth/sessions";
import { hashToken } from "@/server/modules/auth/tokens";
import { effectivePermissions } from "@/server/modules/rbac/authorization";
import { PERMISSION_CODES, type PermissionCode } from "@/server/modules/rbac/catalog";
import {
  createEmployeeManagementService,
  EMPLOYEE_MANAGEMENT_POLICY,
  type StaffActor,
} from "@/server/modules/rbac/employees-service";
import { createRolesService } from "@/server/modules/rbac/roles-service";
import { MS_PER_HOUR, MS_PER_MINUTE } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/**
 * Roles, permissions, employee management and invitations (TASK-012) against
 * the test database.
 */

const db = getDb();
const START = new Date("2026-10-01T10:00:00.000Z").getTime();
let nowMs = START;
const clock = { now: () => new Date(nowMs) };
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 });

const outbox: EmailMessage[] = [];
const email: EmailSender = {
  async send(message) {
    outbox.push(message);
  },
};

const DASHBOARD = "https://dash.beautyfits.example";
const employees = createEmployeeManagementService({
  db,
  clock,
  hasher,
  email,
  dashboardUrl: () => DASHBOARD,
});
const roles = createRolesService({ db, clock });
const staffAuth = createEmployeeAuthService({ db, clock, hasher, email });

const logLines: string[] = [];
const logger = createLogger({ level: "debug", write: (_level, line) => logLines.push(line) });

const PASSWORD = "teal lantern over the nile";
const NEW_STAFF_PASSWORD = "copper kite above the delta";

function meta(ip: string | null = "198.51.100.4"): RequestMeta {
  return { ip, userAgent: "vitest", logger };
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

let counter = 0;

async function createRole(codes: PermissionCode[], options: { system?: boolean } = {}) {
  counter += 1;
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  return db.role.create({
    data: {
      name: `Role ${counter}`,
      isSystemRole: options.system ?? false,
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
}

async function createStaff(
  level: EmployeeLevel,
  options: { roleIds?: string[]; email?: string; active?: boolean } = {},
) {
  counter += 1;
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: options.email ?? `staff${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(nowMs),
      passwordHash: await hasher.hash(PASSWORD),
      status: "ACTIVE",
      employee: {
        create: {
          displayName: `Staff ${counter}`,
          employeeLevel: level,
          status: options.active === false ? "DEACTIVATED" : "ACTIVE",
          roles: { create: (options.roleIds ?? []).map((roleId) => ({ roleId })) },
        },
      },
    },
    include: { employee: true },
  });
  return { account, employee: account.employee! };
}

async function actorOf(staff: Awaited<ReturnType<typeof createStaff>>): Promise<StaffActor> {
  return {
    employeeId: staff.employee.id,
    accountId: staff.account.id,
    level: staff.employee.employeeLevel,
    permissions: await effectivePermissions(db, staff.employee),
  };
}

/** A Manager with EMPLOYEE_MANAGE plus the given permissions. */
async function managerWith(codes: PermissionCode[]) {
  const role = await createRole(["EMPLOYEE_VIEW", "EMPLOYEE_MANAGE", ...codes]);
  const manager = await createStaff("MANAGER", { roleIds: [role.id] });
  return { manager, actor: await actorOf(manager) };
}

function lastInvitationToken(to: string): string {
  const message = outbox.findLast((m) => m.to === to);
  const match = message && /#token=(bfi_[A-Za-z0-9_-]+)/.exec(message.text);
  if (!match) {
    throw new Error(`no invitation mailed to ${to}`);
  }
  return match[1];
}

function invite(
  actor: StaffActor,
  input: Partial<{
    email: string;
    displayName: string;
    department: string | null;
    level: EmployeeLevel;
    roleIds: string[];
  }> = {},
) {
  return employees.invite(
    actor,
    {
      email: "sara@beautyfits.example",
      displayName: "Sara Adel",
      level: "EMPLOYEE",
      roleIds: [],
      ...input,
    },
    meta(),
  );
}

beforeEach(async () => {
  await resetDatabase();
  nowMs = START;
  outbox.length = 0;
  logLines.length = 0;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("permission catalog in the database", () => {
  it("holds exactly the catalog codes (inserted by the migration)", async () => {
    const rows = await db.permission.findMany({ select: { code: true } });
    expect(rows.map((r) => r.code).sort()).toEqual([...PERMISSION_CODES].sort());
  });
});

describe("effective permissions", () => {
  it("gives the Owner and Admins every permission without roles", async () => {
    for (const level of ["OWNER", "ADMIN"] as const) {
      const staff = await createStaff(level);
      expect((await effectivePermissions(db, staff.employee)).size).toBe(PERMISSION_CODES.length);
    }
  });

  it("is the union of the roles' permissions for Managers and Employees", async () => {
    const a = await createRole(["ORDERS_VIEW", "CONFIRM_ORDER"]);
    const b = await createRole(["ORDERS_VIEW", "RETURNS_VIEW"]);
    const staff = await createStaff("EMPLOYEE", { roleIds: [a.id, b.id] });
    expect([...(await effectivePermissions(db, staff.employee))].sort()).toEqual([
      "CONFIRM_ORDER",
      "ORDERS_VIEW",
      "RETURNS_VIEW",
    ]);
    const none = await createStaff("EMPLOYEE");
    expect((await effectivePermissions(db, none.employee)).size).toBe(0);
  });

  it("drops Owner/Admin-only permissions even if a role holds them", async () => {
    const role = await createRole(["ADJUST_WALLET", "VIEW_AUDIT_LOGS", "ORDERS_VIEW"]);
    const manager = await createStaff("MANAGER", { roleIds: [role.id] });
    expect([...(await effectivePermissions(db, manager.employee))]).toEqual(["ORDERS_VIEW"]);
  });
});

describe("roles", () => {
  it("creates and edits custom roles; edits apply to holders at once", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    const role = await roles.createRole(
      owner,
      { name: "Packers", description: "Warehouse packing", permissions: ["ORDERS_VIEW"] },
      logger,
    );
    expect(role).toMatchObject({
      name: "Packers",
      isSystemRole: false,
      permissions: ["ORDERS_VIEW"],
      employeeCount: 0,
    });
    const packer = await createStaff("EMPLOYEE", { roleIds: [role.id] });

    const updated = await roles.updateRole(
      owner,
      role.id,
      { permissions: ["ORDERS_VIEW", "START_PREPARING"] },
      logger,
    );
    expect(updated.permissions).toEqual(["ORDERS_VIEW", "START_PREPARING"]);
    expect(updated.employeeCount).toBe(1);
    expect(updated.description).toBe("Warehouse packing");
    expect([...(await effectivePermissions(db, packer.employee))].sort()).toEqual([
      "ORDERS_VIEW",
      "START_PREPARING",
    ]);

    const list = await roles.listRoles();
    expect(list.map((r) => r.name)).toEqual(["Packers"]);
  });

  it("keeps role names unique ignoring case", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    await roles.createRole(owner, { name: "Packers", permissions: [] }, logger);
    const error = await expectCode(
      roles.createRole(owner, { name: "PACKERS", permissions: [] }, logger),
      "CONFLICT",
    );
    expect(error.details).toEqual({ reason: "ROLE_NAME_TAKEN" });
    const other = await roles.createRole(owner, { name: "Pickers", permissions: [] }, logger);
    await expectCode(roles.updateRole(owner, other.id, { name: "packers" }, logger), "CONFLICT");
    await roles.updateRole(owner, other.id, { name: "PICKERS" }, logger);
  });

  it("refuses Owner/Admin-only permissions in a role", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    const error = await expectCode(
      roles.createRole(owner, { name: "Bad", permissions: ["ADJUST_WALLET"] }, logger),
      "VALIDATION_ERROR",
    );
    expect(JSON.stringify(error.details)).toContain("permission_owner_admin_only");
  });

  it("never changes a system role, and reports unknown roles", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    const system = await createRole([], { system: true });
    const error = await expectCode(
      roles.updateRole(owner, system.id, { name: "Mine" }, logger),
      "PERMISSION_DENIED",
    );
    expect(error.details).toEqual({ reason: "SYSTEM_ROLE" });
    await expectCode(
      roles.updateRole(owner, "019a0000-0000-7000-8000-000000000000", { name: "X" }, logger),
      "NOT_FOUND",
    );
  });
});

describe("invitations (Q64, Q65)", () => {
  it("lets the Owner invite an Admin; the email carries a single-use link", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    const result = await invite(owner, { level: "ADMIN", department: "Operations" });
    expect(result.emailSent).toBe(true);
    expect(result.invitation).toMatchObject({
      email: "sara@beautyfits.example",
      displayName: "Sara Adel",
      department: "Operations",
      level: "ADMIN",
      status: "PENDING",
      invitedBy: { id: owner.employeeId },
      expiresAt: new Date(START + EMPLOYEE_MANAGEMENT_POLICY.invitationTtlMs).toISOString(),
    });
    const token = lastInvitationToken("sara@beautyfits.example");
    expect(outbox.at(-1)?.text).toContain(`${DASHBOARD}/staff/accept-invitation#token=`);
    const row = await db.employeeInvitation.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(logLines.join("\n")).not.toContain(token);
    expect(logLines.join("\n")).not.toContain("sara@beautyfits.example");
  });

  it("enforces the hierarchy: Admins cannot invite Admins, Managers only Employees", async () => {
    const admin = await actorOf(await createStaff("ADMIN"));
    const denied = await expectCode(invite(admin, { level: "ADMIN" }), "PERMISSION_DENIED");
    expect(denied.details).toEqual({ reason: "HIERARCHY" });
    await invite(admin, { level: "MANAGER" });

    const { actor: manager } = await managerWith([]);
    await expectCode(
      invite(manager, { email: "m2@beautyfits.example", level: "MANAGER" }),
      "PERMISSION_DENIED",
    );
    await invite(manager, { email: "e2@beautyfits.example", level: "EMPLOYEE" });
  });

  it("never lets the Employee level invite, even with EMPLOYEE_MANAGE", async () => {
    const role = await createRole(["EMPLOYEE_MANAGE"]);
    const employee = await actorOf(await createStaff("EMPLOYEE", { roleIds: [role.id] }));
    expect(employee.permissions.has("EMPLOYEE_MANAGE")).toBe(true);
    await expectCode(invite(employee), "PERMISSION_DENIED");
  });

  it("lets a Manager give only roles within their own permissions", async () => {
    const { actor: manager } = await managerWith(["ORDERS_VIEW", "CONFIRM_ORDER"]);
    const inside = await createRole(["ORDERS_VIEW"]);
    const outside = await createRole(["ORDERS_VIEW", "CANCEL_ORDER"]);
    const error = await expectCode(
      invite(manager, { roleIds: [inside.id, outside.id] }),
      "PERMISSION_DENIED",
    );
    expect(error.details).toEqual({ reason: "ROLE_OUTSIDE_SCOPE", roleIds: [outside.id] });
    const ok = await invite(manager, { roleIds: [inside.id] });
    expect(ok.invitation.roles).toEqual([{ id: inside.id, name: inside.name }]);
  });

  it("refuses unknown and system roles", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    await expectCode(
      invite(owner, { roleIds: ["019a0000-0000-7000-8000-000000000000"] }),
      "VALIDATION_ERROR",
    );
    const system = await createRole([], { system: true });
    await expectCode(invite(owner, { roleIds: [system.id] }), "VALIDATION_ERROR");
  });

  it("refuses an email that is already an employee or has a pending invitation", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    await createStaff("EMPLOYEE", { email: "taken@beautyfits.example" });
    const exists = await expectCode(
      invite(owner, { email: "taken@beautyfits.example" }),
      "CONFLICT",
    );
    expect(exists.details).toEqual({ reason: "EMPLOYEE_EXISTS" });

    const first = await invite(owner);
    const pending = await expectCode(invite(owner), "CONFLICT");
    expect(pending.details).toMatchObject({ reason: "INVITATION_PENDING" });

    await employees.revokeInvitation(owner, first.invitation.id, logger);
    const second = await invite(owner);
    nowMs += EMPLOYEE_MANAGEMENT_POLICY.invitationTtlMs;
    const third = await invite(owner);
    expect(third.invitation.id).not.toBe(second.invitation.id);
  });

  it("allows the email of a customer account (R15)", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    await db.account.create({
      data: {
        accountType: "CUSTOMER",
        email: "sara@beautyfits.example",
        emailVerifiedAt: new Date(nowMs),
        passwordHash: await hasher.hash(PASSWORD),
        status: "ACTIVE",
      },
    });
    await invite(owner);
  });

  it("still commits the invitation when the email cannot be sent", async () => {
    const failing = createEmployeeManagementService({
      db,
      clock,
      hasher,
      email: { send: async () => Promise.reject(new Error("disk full")) },
      dashboardUrl: () => DASHBOARD,
    });
    const owner = await actorOf(await createStaff("OWNER"));
    const result = await failing.invite(
      owner,
      { email: "sara@beautyfits.example", displayName: "Sara", level: "EMPLOYEE", roleIds: [] },
      meta(),
    );
    expect(result.emailSent).toBe(false);
    expect(await db.employeeInvitation.count()).toBe(1);
  });

  it("revokes only pending invitations within the hierarchy", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    const admin = await actorOf(await createStaff("ADMIN"));
    const adminInvite = await invite(owner, { level: "ADMIN" });
    await expectCode(
      employees.revokeInvitation(admin, adminInvite.invitation.id, logger),
      "PERMISSION_DENIED",
    );
    const revoked = await employees.revokeInvitation(owner, adminInvite.invitation.id, logger);
    expect(revoked.status).toBe("REVOKED");
    const again = await expectCode(
      employees.revokeInvitation(owner, adminInvite.invitation.id, logger),
      "CONFLICT",
    );
    expect(again.details).toMatchObject({ status: "REVOKED" });
    await expectCode(
      employees.revokeInvitation(owner, "019a0000-0000-7000-8000-000000000000", logger),
      "NOT_FOUND",
    );
  });

  it("lists invitations by status", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    const a = await invite(owner, { email: "a@beautyfits.example" });
    await invite(owner, { email: "b@beautyfits.example" });
    await employees.revokeInvitation(owner, a.invitation.id, logger);
    const pending = await employees.listInvitations({ page: 1, pageSize: 24, status: "PENDING" });
    expect(pending.items.map((i) => i.email)).toEqual(["b@beautyfits.example"]);
    const all = await employees.listInvitations({ page: 1, pageSize: 1 });
    expect(all.pagination).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    nowMs += EMPLOYEE_MANAGEMENT_POLICY.invitationTtlMs;
    const expired = await employees.listInvitations({ page: 1, pageSize: 24, status: "EXPIRED" });
    expect(expired.items.map((i) => i.email)).toEqual(["b@beautyfits.example"]);
  });
});

describe("accepting an invitation", () => {
  async function invited(level: EmployeeLevel = "EMPLOYEE", roleIds: string[] = []) {
    const ownerStaff = await createStaff("OWNER");
    const owner = await actorOf(ownerStaff);
    await invite(owner, { level, roleIds, department: "Warehouse" });
    return { owner, token: lastInvitationToken("sara@beautyfits.example") };
  }

  it("creates an active employee with the chosen level and roles, who then signs in", async () => {
    const role = await createRole(["ORDERS_VIEW"]);
    const { owner, token } = await invited("MANAGER", [role.id]);
    const result = await employees.acceptInvitation(
      { invitationToken: token, password: NEW_STAFF_PASSWORD },
      meta(),
    );
    expect(result).toMatchObject({
      account: { email: "sara@beautyfits.example", status: "ACTIVE" },
      employee: { displayName: "Sara Adel", level: "MANAGER", department: "Warehouse" },
    });
    const employee = await db.employee.findUniqueOrThrow({
      where: { id: result.employee.id },
      include: { roles: true, account: true },
    });
    expect(employee.createdByEmployeeId).toBe(owner.employeeId);
    expect(employee.account.emailVerifiedAt).not.toBeNull();
    expect(employee.roles).toMatchObject([
      { roleId: role.id, assignedByEmployeeId: owner.employeeId },
    ]);
    const invitation = await db.employeeInvitation.findFirstOrThrow();
    expect(invitation.acceptedEmployeeId).toBe(employee.id);

    // The first login confirms the device with an email code (R28).
    const login = await staffAuth.login(
      { email: "sara@beautyfits.example", password: NEW_STAFF_PASSWORD },
      meta(),
    );
    expect(login.otpRequired).toBe(true);
  });

  it("works only once", async () => {
    const { token } = await invited();
    await employees.acceptInvitation(
      { invitationToken: token, password: NEW_STAFF_PASSWORD },
      meta(),
    );
    await expectCode(
      employees.acceptInvitation({ invitationToken: token, password: NEW_STAFF_PASSWORD }, meta()),
      "AUTH_OTP_INVALID",
    );
  });

  it("lets only one of two concurrent acceptances succeed", async () => {
    const { token } = await invited();
    const results = await Promise.allSettled([
      employees.acceptInvitation({ invitationToken: token, password: NEW_STAFF_PASSWORD }, meta()),
      employees.acceptInvitation({ invitationToken: token, password: NEW_STAFF_PASSWORD }, meta()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.employee.count({ where: { account: { email: "sara@beautyfits.example" } } }),
    ).toBe(1);
  });

  it("refuses unknown, malformed, revoked and expired invitations", async () => {
    const { owner, token } = await invited();
    await expectCode(
      employees.acceptInvitation(
        { invitationToken: "bfi_nope", password: NEW_STAFF_PASSWORD },
        meta(),
      ),
      "AUTH_OTP_INVALID",
    );
    nowMs += EMPLOYEE_MANAGEMENT_POLICY.invitationTtlMs;
    await expectCode(
      employees.acceptInvitation({ invitationToken: token, password: NEW_STAFF_PASSWORD }, meta()),
      "AUTH_OTP_EXPIRED",
    );
    nowMs = START + MS_PER_HOUR;
    const row = await db.employeeInvitation.findFirstOrThrow();
    await employees.revokeInvitation(owner, row.id, logger);
    await expectCode(
      employees.acceptInvitation({ invitationToken: token, password: NEW_STAFF_PASSWORD }, meta()),
      "AUTH_OTP_INVALID",
    );
    expect(await db.employee.count()).toBe(1);
  });

  it("stops working when the inviter is deactivated or can no longer grant it", async () => {
    const { manager, actor } = await managerWith(["ORDERS_VIEW"]);
    const role = await createRole(["ORDERS_VIEW"]);
    await invite(actor, { roleIds: [role.id] });
    const token = lastInvitationToken("sara@beautyfits.example");

    // The role now holds a permission the Manager lacks.
    const owner = await actorOf(await createStaff("OWNER"));
    await roles.updateRole(
      owner,
      role.id,
      { permissions: ["ORDERS_VIEW", "CANCEL_ORDER"] },
      logger,
    );
    await expectCode(
      employees.acceptInvitation({ invitationToken: token, password: NEW_STAFF_PASSWORD }, meta()),
      "AUTH_OTP_INVALID",
    );
    await roles.updateRole(owner, role.id, { permissions: ["ORDERS_VIEW"] }, logger);

    await employees.deactivateEmployee(owner, manager.employee.id, logger);
    await expectCode(
      employees.acceptInvitation({ invitationToken: token, password: NEW_STAFF_PASSWORD }, meta()),
      "AUTH_OTP_INVALID",
    );
    expect(await db.employeeInvitation.count({ where: { acceptedAt: { not: null } } })).toBe(0);
  });

  it("blocks an IP after 30 rejected invitations in 15 minutes", async () => {
    const { token } = await invited();
    for (let i = 0; i < 30; i += 1) {
      await expectCode(
        employees.acceptInvitation(
          { invitationToken: `bfi_${"x".repeat(43)}`, password: NEW_STAFF_PASSWORD },
          meta(),
        ),
        "AUTH_OTP_INVALID",
      );
    }
    const blocked = await expectCode(
      employees.acceptInvitation({ invitationToken: token, password: NEW_STAFF_PASSWORD }, meta()),
      "AUTH_RATE_LIMITED",
    );
    expect(blocked.details).toMatchObject({ retryAfterSeconds: 900 });
    nowMs += 15 * MS_PER_MINUTE;
    await employees.acceptInvitation(
      { invitationToken: token, password: NEW_STAFF_PASSWORD },
      meta(),
    );
  });
});

describe("editing employees", () => {
  it("lets the Owner change an employee's level and roles", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    const a = await createRole(["ORDERS_VIEW"]);
    const b = await createRole(["RETURNS_VIEW"]);
    const target = await createStaff("EMPLOYEE", { roleIds: [a.id] });
    const updated = await employees.updateEmployee(
      owner,
      target.employee.id,
      { level: "MANAGER", roleIds: [b.id], displayName: "New Name", department: null },
      logger,
    );
    expect(updated).toMatchObject({
      level: "MANAGER",
      displayName: "New Name",
      department: null,
      roles: [{ id: b.id, name: b.name }],
    });
    const assignment = await db.employeeRole.findFirstOrThrow({
      where: { employeeId: target.employee.id },
    });
    expect(assignment.assignedByEmployeeId).toBe(owner.employeeId);
  });

  it("keeps Admins away from the Owner and other Admins, and from the Admin level", async () => {
    const ownerStaff = await createStaff("OWNER");
    const admin = await actorOf(await createStaff("ADMIN"));
    const otherAdmin = await createStaff("ADMIN");
    const manager = await createStaff("MANAGER");
    await expectCode(
      employees.updateEmployee(admin, ownerStaff.employee.id, { displayName: "X" }, logger),
      "PERMISSION_DENIED",
    );
    await expectCode(
      employees.updateEmployee(admin, otherAdmin.employee.id, { displayName: "X" }, logger),
      "PERMISSION_DENIED",
    );
    await expectCode(
      employees.updateEmployee(admin, manager.employee.id, { level: "ADMIN" }, logger),
      "PERMISSION_DENIED",
    );
    await employees.updateEmployee(admin, manager.employee.id, { level: "EMPLOYEE" }, logger);
  });

  it("lets nobody change their own level or roles, but allows their own name", async () => {
    const ownerStaff = await createStaff("OWNER");
    const owner = await actorOf(ownerStaff);
    const role = await createRole(["ORDERS_VIEW"]);
    const self = await expectCode(
      employees.updateEmployee(owner, owner.employeeId, { level: "ADMIN" }, logger),
      "PERMISSION_DENIED",
    );
    expect(self.details).toEqual({ reason: "SELF" });
    await expectCode(
      employees.updateEmployee(owner, owner.employeeId, { roleIds: [role.id] }, logger),
      "PERMISSION_DENIED",
    );
    const renamed = await employees.updateEmployee(
      owner,
      owner.employeeId,
      { displayName: "Magdy", level: "OWNER" },
      logger,
    );
    expect(renamed).toMatchObject({ displayName: "Magdy", level: "OWNER" });
  });

  it("lets a Manager add or remove only roles within their own permissions", async () => {
    const { actor: manager } = await managerWith(["ORDERS_VIEW"]);
    const inside = await createRole(["ORDERS_VIEW"]);
    const outside = await createRole(["CANCEL_ORDER"]);
    const target = await createStaff("EMPLOYEE", { roleIds: [outside.id] });

    // Removing a role the Manager could not grant is refused too.
    await expectCode(
      employees.updateEmployee(manager, target.employee.id, { roleIds: [inside.id] }, logger),
      "PERMISSION_DENIED",
    );
    const updated = await employees.updateEmployee(
      manager,
      target.employee.id,
      { roleIds: [outside.id, inside.id] },
      logger,
    );
    expect(updated.roles.map((r) => r.id).sort()).toEqual([inside.id, outside.id].sort());
    await expectCode(
      employees.updateEmployee(manager, target.employee.id, { level: "MANAGER" }, logger),
      "PERMISSION_DENIED",
    );
  });

  it("reports an unknown employee", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    await expectCode(
      employees.updateEmployee(
        owner,
        "019a0000-0000-7000-8000-000000000000",
        { displayName: "X" },
        logger,
      ),
      "NOT_FOUND",
    );
  });

  it("lists employees with filters and pagination", async () => {
    await createStaff("OWNER");
    await createStaff("MANAGER");
    await createStaff("EMPLOYEE", { active: false });
    const managers = await employees.listEmployees({ page: 1, pageSize: 24, level: "MANAGER" });
    expect(managers.items.map((e) => e.level)).toEqual(["MANAGER"]);
    const inactive = await employees.listEmployees({
      page: 1,
      pageSize: 24,
      status: "DEACTIVATED",
    });
    expect(inactive.items).toHaveLength(1);
    const page = await employees.listEmployees({ page: 2, pageSize: 2 });
    expect(page.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(page.items).toHaveLength(1);
    const search = await employees.listEmployees({ page: 1, pageSize: 24, search: "STAFF" });
    expect(search.pagination.total).toBe(3);
  });
});

describe("deactivation (Q69)", () => {
  it("removes access: sessions revoked, trusted devices forgotten, history kept", async () => {
    const owner = await actorOf(await createStaff("OWNER"));
    const target = await createStaff("EMPLOYEE");
    const session = await createSession(
      db,
      { accountId: target.account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
      { ip: null, userAgent: null },
      new Date(nowMs),
    );
    await db.employeeTrustedDevice.create({
      data: {
        accountId: target.account.id,
        deviceTokenHash: "a".repeat(64),
        verifiedAt: new Date(nowMs),
        expiresAt: new Date(nowMs + 30 * 24 * MS_PER_HOUR),
      },
    });

    const result = await employees.deactivateEmployee(owner, target.employee.id, logger);
    expect(result).toMatchObject({
      status: "DEACTIVATED",
      deactivatedAt: new Date(START).toISOString(),
    });
    const revoked = await db.authSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(revoked).toMatchObject({ revokeReason: "DEACTIVATED" });
    expect(await db.employeeTrustedDevice.count({ where: { revokedAt: null } })).toBe(0);
    await expectCode(staffAuth.authenticate(session.tokens.accessToken), "UNAUTHENTICATED");
    expect(await db.employee.count()).toBe(2);

    // Deactivating again changes nothing.
    nowMs += MS_PER_HOUR;
    const again = await employees.deactivateEmployee(owner, target.employee.id, logger);
    expect(again.deactivatedAt).toBe(new Date(START).toISOString());
  });

  it("refuses self-deactivation and targets outside the hierarchy", async () => {
    const ownerStaff = await createStaff("OWNER");
    const owner = await actorOf(ownerStaff);
    const admin = await actorOf(await createStaff("ADMIN"));
    await expectCode(
      employees.deactivateEmployee(owner, owner.employeeId, logger),
      "PERMISSION_DENIED",
    );
    await expectCode(
      employees.deactivateEmployee(admin, ownerStaff.employee.id, logger),
      "PERMISSION_DENIED",
    );
    const { actor: manager } = await managerWith([]);
    const otherManager = await createStaff("MANAGER");
    await expectCode(
      employees.deactivateEmployee(manager, otherManager.employee.id, logger),
      "PERMISSION_DENIED",
    );
  });
});
