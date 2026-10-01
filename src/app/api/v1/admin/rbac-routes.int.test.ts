import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { POST as deactivate } from "@/app/api/v1/admin/employees/[id]/deactivate/route";
import { PATCH as updateEmployee } from "@/app/api/v1/admin/employees/[id]/route";
import { POST as revokeInvitation } from "@/app/api/v1/admin/employees/invitations/[id]/revoke/route";
import { GET as listInvitations } from "@/app/api/v1/admin/employees/invitations/route";
import { GET as listEmployees, POST as inviteEmployee } from "@/app/api/v1/admin/employees/route";
import { GET as listPermissions } from "@/app/api/v1/admin/permissions/route";
import { PATCH as updateRole } from "@/app/api/v1/admin/roles/[id]/route";
import { GET as listRoles, POST as createRole } from "@/app/api/v1/admin/roles/route";
import { POST as acceptInvitation } from "@/app/api/v1/employee-auth/accept-invitation/route";
import { POST as login } from "@/app/api/v1/employee-auth/login/route";
import { GET as session } from "@/app/api/v1/employee-auth/session/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import { PERMISSION_CODES, type PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of the employee, role and permission endpoints (API
 * contract §25, "TASK-012 Amendments") and accept-invitation: permission
 * checks, the hierarchy, the invitation flow end to end.
 */

const db = getDb();
const BASE = "http://localhost/api/v1";
const SAME_ORIGIN = "http://localhost";
const PASSWORD = "teal lantern over the nile";
const NEW_PASSWORD = "copper kite above the delta";
const hasher = createScryptHasher();

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    token?: string;
    headers?: Record<string, string>;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) as Promise<never> },
  );
}

let counter = 0;

async function role(codes: PermissionCode[]) {
  counter += 1;
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  return db.role.create({
    data: {
      name: `Role ${counter}`,
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
}

/** An employee with a live session; returns its Bearer access token. */
async function staff(level: EmployeeLevel, codes: PermissionCode[] = []) {
  counter += 1;
  const roles = codes.length > 0 ? [await role(codes)] : [];
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `staff${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: await hasher.hash(PASSWORD),
      status: "ACTIVE",
      employee: {
        create: {
          displayName: `Staff ${counter}`,
          employeeLevel: level,
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
      },
    },
    include: { employee: true },
  });
  const created = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return { account, employee: account.employee!, token: created.tokens.accessToken };
}

async function mailedInvitationToken(to: string): Promise<string> {
  const dir = getEnv().MAIL_DIR;
  const files = (await readdir(dir)).filter((name) => name.endsWith(".eml")).sort();
  for (const name of files.reverse()) {
    const eml = await readFile(join(dir, name), "utf8");
    if (!eml.includes(`\r\nTo: ${to}\r\n`)) {
      continue;
    }
    const body = Buffer.from(eml.split("\r\n\r\n")[1].replace(/\s/g, ""), "base64");
    const match = /#token=(bfi_[A-Za-z0-9_-]+)/.exec(body.toString("utf8"));
    if (match) {
      return match[1];
    }
  }
  throw new Error(`no invitation mailed to ${to}`);
}

beforeEach(async () => {
  await resetDatabase();
  await rm(getEnv().MAIL_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("permission checks", () => {
  it("answers 401 without a session and 403 FORBIDDEN for a customer token", async () => {
    const anonymous = await call(listRoles, "/admin/roles");
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBe("UNAUTHENTICATED");

    const customer = await db.account.create({
      data: {
        accountType: "CUSTOMER",
        email: "c@beautyfits.example",
        emailVerifiedAt: new Date(),
        passwordHash: "x",
        status: "ACTIVE",
      },
    });
    const customerSession = await createSession(
      db,
      { accountId: customer.id, domain: "CUSTOMER", ttlMs: MS_PER_HOUR },
      { ip: null, userAgent: null },
      new Date(),
    );
    const res = await call(listRoles, "/admin/roles", {
      token: customerSession.tokens.accessToken,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("answers 403 PERMISSION_DENIED naming the missing permission", async () => {
    const employee = await staff("EMPLOYEE", ["ORDERS_VIEW"]);
    const res = await call(listEmployees, "/admin/employees", { token: employee.token });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({
      code: "PERMISSION_DENIED",
      details: { requiredPermissions: ["EMPLOYEE_VIEW"] },
    });
  });

  it("never lets a Manager manage roles, even through a role that names ROLE_MANAGE", async () => {
    const manager = await staff("MANAGER", ["ROLE_VIEW", "ROLE_MANAGE"]);
    expect((await call(listRoles, "/admin/roles", { token: manager.token })).status).toBe(200);
    const res = await call(createRole, "/admin/roles", {
      method: "POST",
      token: manager.token,
      body: { name: "Mine", permissions: [] },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PERMISSION_DENIED");
  });

  it("requires the Origin check for cookie-authenticated changes", async () => {
    const owner = await staff("OWNER");
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    const body = { name: "Packers", permissions: [] };
    const blocked = await call(createRole, "/admin/roles", {
      method: "POST",
      headers: { cookie },
      body,
    });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("FORBIDDEN");
    const allowed = await call(createRole, "/admin/roles", {
      method: "POST",
      headers: { cookie, origin: SAME_ORIGIN },
      body,
    });
    expect(allowed.status).toBe(201);
  });

  it("lists the signed-in employee's permissions in the session", async () => {
    const employee = await staff("EMPLOYEE", ["ORDERS_VIEW", "CONFIRM_ORDER"]);
    const res = await call(session, "/employee-auth/session", { token: employee.token });
    expect((await res.json()).data.permissions).toEqual(["ORDERS_VIEW", "CONFIRM_ORDER"]);
    const owner = await staff("OWNER");
    const ownerRes = await call(session, "/employee-auth/session", { token: owner.token });
    expect((await ownerRes.json()).data.permissions).toEqual([...PERMISSION_CODES]);
  });
});

describe("roles and permissions", () => {
  it("lists the catalog with the Owner/Admin-only flag", async () => {
    const viewer = await staff("EMPLOYEE", ["ROLE_VIEW"]);
    const res = await call(listPermissions, "/admin/permissions", { token: viewer.token });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { code: string; ownerAdminOnly: boolean }[];
    expect(data).toHaveLength(PERMISSION_CODES.length);
    expect(data.find((p) => p.code === "ADJUST_WALLET")?.ownerAdminOnly).toBe(true);
    expect(data.find((p) => p.code === "ORDERS_VIEW")?.ownerAdminOnly).toBe(false);
  });

  it("creates and edits a custom role", async () => {
    const admin = await staff("ADMIN");
    const created = await call(createRole, "/admin/roles", {
      method: "POST",
      token: admin.token,
      body: { name: "Packers", permissions: ["START_PREPARING", "ORDERS_VIEW"] },
    });
    expect(created.status).toBe(201);
    const roleView = (await created.json()).data;
    expect(roleView).toMatchObject({
      name: "Packers",
      description: null,
      permissions: ["ORDERS_VIEW", "START_PREPARING"],
    });

    const edited = await call(updateRole, `/admin/roles/${roleView.id}`, {
      method: "PATCH",
      token: admin.token,
      params: { id: roleView.id },
      body: { description: "Packing team" },
    });
    expect((await edited.json()).data).toMatchObject({ description: "Packing team" });

    const unknownCode = await call(createRole, "/admin/roles", {
      method: "POST",
      token: admin.token,
      body: { name: "X", permissions: ["FLY"] },
    });
    expect(unknownCode.status).toBe(400);
    const missing = await call(updateRole, "/admin/roles/nope", {
      method: "PATCH",
      token: admin.token,
      params: { id: "nope" },
      body: { name: "Y" },
    });
    expect(missing.status).toBe(404);
  });
});

describe("invitation flow", () => {
  it("invites, accepts and lets the new employee sign in", async () => {
    const manager = await staff("MANAGER", ["EMPLOYEE_VIEW", "EMPLOYEE_MANAGE", "ORDERS_VIEW"]);
    const packers = await role(["ORDERS_VIEW"]);
    const res = await call(inviteEmployee, "/admin/employees", {
      method: "POST",
      token: manager.token,
      body: {
        email: "Sara@BeautyFits.Example",
        displayName: "Sara Adel",
        level: "EMPLOYEE",
        roleIds: [packers.id],
      },
    });
    expect(res.status).toBe(201);
    const { invitation, emailSent } = (await res.json()).data;
    expect(emailSent).toBe(true);
    expect(invitation).toMatchObject({ email: "sara@beautyfits.example", status: "PENDING" });

    const pending = await call(listInvitations, "/admin/employees/invitations?status=PENDING", {
      token: manager.token,
    });
    expect((await pending.json()).data).toHaveLength(1);

    const token = await mailedInvitationToken("sara@beautyfits.example");
    const weak = await call(acceptInvitation, "/employee-auth/accept-invitation", {
      method: "POST",
      body: { invitationToken: token, password: "short" },
    });
    expect(weak.status).toBe(400);
    const accepted = await call(acceptInvitation, "/employee-auth/accept-invitation", {
      method: "POST",
      body: { invitationToken: token, password: NEW_PASSWORD },
    });
    expect(accepted.status).toBe(201);
    expect((await accepted.json()).data).toMatchObject({
      account: { email: "sara@beautyfits.example", status: "ACTIVE" },
      employee: { displayName: "Sara Adel", level: "EMPLOYEE" },
    });
    const reused = await call(acceptInvitation, "/employee-auth/accept-invitation", {
      method: "POST",
      body: { invitationToken: token, password: NEW_PASSWORD },
    });
    expect(reused.status).toBe(401);
    expect((await reused.json()).error.code).toBe("AUTH_OTP_INVALID");

    const signIn = await call(login, "/employee-auth/login", {
      method: "POST",
      body: { email: "sara@beautyfits.example", password: NEW_PASSWORD },
    });
    expect(signIn.status).toBe(202);

    const list = await call(listEmployees, "/admin/employees?search=sara", {
      token: manager.token,
    });
    const listed = await list.json();
    expect(listed.data).toMatchObject([
      { email: "sara@beautyfits.example", roles: [{ id: packers.id }] },
    ]);
    expect(listed.meta.pagination).toEqual({ page: 1, pageSize: 24, total: 1, totalPages: 1 });
  });

  it("stops a Manager from inviting a Manager", async () => {
    const manager = await staff("MANAGER", ["EMPLOYEE_MANAGE"]);
    const res = await call(inviteEmployee, "/admin/employees", {
      method: "POST",
      token: manager.token,
      body: { email: "m@beautyfits.example", displayName: "M", level: "MANAGER" },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({
      code: "PERMISSION_DENIED",
      details: { reason: "HIERARCHY" },
    });
  });

  it("revokes a pending invitation", async () => {
    const owner = await staff("OWNER");
    const res = await call(inviteEmployee, "/admin/employees", {
      method: "POST",
      token: owner.token,
      body: { email: "a@beautyfits.example", displayName: "A", level: "ADMIN" },
    });
    const { invitation } = (await res.json()).data;
    const revoked = await call(
      revokeInvitation,
      `/admin/employees/invitations/${invitation.id}/revoke`,
      { method: "POST", token: owner.token, params: { id: invitation.id } },
    );
    expect((await revoked.json()).data.status).toBe("REVOKED");
  });
});

describe("editing and deactivating employees", () => {
  it("changes roles and level, then deactivation ends the employee's access", async () => {
    const admin = await staff("ADMIN");
    const target = await staff("EMPLOYEE");
    const r = await role(["ORDERS_VIEW"]);
    const patched = await call(updateEmployee, `/admin/employees/${target.employee.id}`, {
      method: "PATCH",
      token: admin.token,
      params: { id: target.employee.id },
      body: { level: "MANAGER", roleIds: [r.id] },
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).data).toMatchObject({ level: "MANAGER", roles: [{ id: r.id }] });

    const before = await call(session, "/employee-auth/session", { token: target.token });
    expect((await before.json()).data.permissions).toEqual(["ORDERS_VIEW"]);

    const res = await call(deactivate, `/admin/employees/${target.employee.id}/deactivate`, {
      method: "POST",
      token: admin.token,
      params: { id: target.employee.id },
    });
    expect((await res.json()).data.status).toBe("DEACTIVATED");
    const after = await call(session, "/employee-auth/session", { token: target.token });
    expect(after.status).toBe(401);
  });

  it("answers 404 for a malformed id and 403 for self-deactivation", async () => {
    const owner = await staff("OWNER");
    const malformed = await call(deactivate, "/admin/employees/123/deactivate", {
      method: "POST",
      token: owner.token,
      params: { id: "123" },
    });
    expect(malformed.status).toBe(404);
    const self = await call(deactivate, `/admin/employees/${owner.employee.id}/deactivate`, {
      method: "POST",
      token: owner.token,
      params: { id: owner.employee.id },
    });
    expect(self.status).toBe(403);
    expect((await self.json()).error.details).toEqual({ reason: "SELF" });
  });
});
