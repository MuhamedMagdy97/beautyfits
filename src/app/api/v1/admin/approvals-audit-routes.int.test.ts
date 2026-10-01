import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/v1/admin/approval-requests/[id]/approve/route";
import { POST as reject } from "@/app/api/v1/admin/approval-requests/[id]/reject/route";
import { GET as approvalDetail } from "@/app/api/v1/admin/approval-requests/[id]/route";
import { GET as listApprovals } from "@/app/api/v1/admin/approval-requests/route";
import { GET as listAuditLogs } from "@/app/api/v1/admin/audit-logs/route";
import { POST as createRole } from "@/app/api/v1/admin/roles/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { requestApproval } from "@/server/modules/approvals/approvals";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of the approval request and audit log endpoints (API
 * contract §25, §26, "TASK-013 Amendments").
 */

const db = getDb();
const BASE = "http://localhost/api/v1";
const SAME_ORIGIN = "http://localhost";
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

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

/** An employee with a live session; returns its Bearer access token. */
async function staff(level: EmployeeLevel, codes: PermissionCode[] = []) {
  counter += 1;
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `staff${counter}@beautyfits.example`,
      emailVerifiedAt: new Date(),
      passwordHash: "unused",
      status: "ACTIVE",
      employee: {
        create: {
          displayName: `Staff ${counter}`,
          employeeLevel: level,
          roles:
            codes.length > 0
              ? {
                  create: [
                    {
                      role: {
                        create: {
                          name: `Role ${counter}`,
                          permissions: {
                            create: permissions.map((p) => ({ permissionId: p.id })),
                          },
                        },
                      },
                    },
                  ],
                }
              : undefined,
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
  return { employee: account.employee!, token: created.tokens.accessToken };
}

function openRequest(requestedByEmployeeId: string, entityId = "returns.window_days") {
  return runInTransaction((tx) =>
    requestApproval(
      tx,
      {
        approvalType: "CRITICAL_SETTING",
        entityType: "SETTING",
        entityId,
        requestedByEmployeeId,
        reason: "New policy",
        metadata: { from: 14, to: 21 },
      },
      { now: new Date() },
    ),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("permission checks", () => {
  it("answers 401 without a session", async () => {
    expect((await call(listApprovals, "/admin/approval-requests")).status).toBe(401);
    expect((await call(listAuditLogs, "/admin/audit-logs")).status).toBe(401);
  });

  it("keeps both to Owner/Admin, even when a Manager's role lists the codes", async () => {
    const manager = await staff("MANAGER", ["APPROVAL_RESOLVE", "VIEW_AUDIT_LOGS", "ORDERS_VIEW"]);
    for (const [handler, path] of [
      [listApprovals, "/admin/approval-requests"],
      [listAuditLogs, "/admin/audit-logs"],
    ] as const) {
      const res = await call(handler, path, { token: manager.token });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("PERMISSION_DENIED");
    }
    const request = await openRequest(manager.employee.id);
    const res = await call(approve, `/admin/approval-requests/${request.id}/approve`, {
      method: "POST",
      token: manager.token,
      params: { id: request.id },
    });
    expect(res.status).toBe(403);
  });

  it("requires the Origin check for cookie-authenticated resolutions", async () => {
    const manager = await staff("MANAGER");
    const admin = await staff("ADMIN");
    const request = await openRequest(manager.employee.id);
    const cookie = `${EMPLOYEE_COOKIES.access}=${admin.token}`;
    const path = `/admin/approval-requests/${request.id}/reject`;
    const options = { method: "POST", body: { reason: "No" }, params: { id: request.id } };
    const blocked = await call(reject, path, { ...options, headers: { cookie } });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("FORBIDDEN");
    const allowed = await call(reject, path, {
      ...options,
      headers: { cookie, origin: SAME_ORIGIN },
    });
    expect(allowed.status).toBe(200);
  });
});

describe("approval requests", () => {
  it("lists, shows and rejects a pending request", async () => {
    const manager = await staff("MANAGER");
    const admin = await staff("ADMIN");
    const request = await openRequest(manager.employee.id);
    await openRequest(manager.employee.id, "shipping.free_threshold");

    const list = await call(listApprovals, "/admin/approval-requests?status=PENDING&pageSize=1", {
      token: admin.token,
    });
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.data).toHaveLength(1);
    expect(listBody.meta.pagination).toMatchObject({ total: 2, pageSize: 1 });

    const bad = await call(listApprovals, "/admin/approval-requests?status=DONE", {
      token: admin.token,
    });
    expect(bad.status).toBe(400);

    const detail = await call(approvalDetail, `/admin/approval-requests/${request.id}`, {
      token: admin.token,
      params: { id: request.id },
    });
    expect((await detail.json()).data).toMatchObject({
      id: request.id,
      approvalType: "CRITICAL_SETTING",
      entityType: "SETTING",
      entityId: "returns.window_days",
      status: "PENDING",
      reason: "New policy",
      metadata: { from: 14, to: 21 },
      requestedBy: { id: manager.employee.id, displayName: manager.employee.displayName },
      resolvedBy: null,
    });
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      const missing = await call(approvalDetail, `/admin/approval-requests/${id}`, {
        token: admin.token,
        params: { id },
      });
      expect(missing.status).toBe(404);
    }

    const path = `/admin/approval-requests/${request.id}/reject`;
    const noReason = await call(reject, path, {
      method: "POST",
      token: admin.token,
      body: { reason: "  " },
      params: { id: request.id },
    });
    expect(noReason.status).toBe(400);

    const rejected = await call(reject, path, {
      method: "POST",
      token: admin.token,
      body: { reason: "Keep 14 days" },
      params: { id: request.id },
    });
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).data).toMatchObject({
      status: "REJECTED",
      resolutionReason: "Keep 14 days",
      resolvedBy: { id: admin.employee.id },
    });

    const again = await call(approve, `/admin/approval-requests/${request.id}/approve`, {
      method: "POST",
      token: admin.token,
      params: { id: request.id },
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.details).toMatchObject({
      reason: "APPROVAL_NOT_PENDING",
      status: "REJECTED",
    });
  });

  it("refuses to let an Admin resolve their own request", async () => {
    const admin = await staff("ADMIN");
    const request = await openRequest(admin.employee.id);
    const res = await call(approve, `/admin/approval-requests/${request.id}/approve`, {
      method: "POST",
      token: admin.token,
      body: {},
      params: { id: request.id },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.details).toMatchObject({ reason: "SELF_APPROVAL" });
  });
});

describe("audit logs", () => {
  it("shows the entry of an API change with the request id as correlation id", async () => {
    const owner = await staff("OWNER");
    const created = await call(createRole, "/admin/roles", {
      method: "POST",
      token: owner.token,
      body: { name: "Packers", permissions: ["ORDERS_VIEW"] },
    });
    expect(created.status).toBe(201);
    const roleId = (await created.json()).data.id;
    const requestId = created.headers.get("x-request-id");

    const res = await call(listAuditLogs, `/admin/audit-logs?entityType=ROLE&entityId=${roleId}`, {
      token: owner.token,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      action: "ROLE_CREATED",
      actor: { type: "EMPLOYEE", id: owner.employee.id, displayName: owner.employee.displayName },
      entityType: "ROLE",
      entityId: roleId,
      previousData: null,
      newData: { name: "Packers", permissions: ["ORDERS_VIEW"] },
      correlationId: requestId,
    });
    expect(body.meta.pagination).toMatchObject({ total: 1 });
  });

  it("validates the filters", async () => {
    const admin = await staff("ADMIN");
    for (const query of [
      "actorType=ROBOT",
      "actorId=nope",
      "from=yesterday",
      "from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z",
      "pageSize=500",
    ]) {
      const res = await call(listAuditLogs, `/admin/audit-logs?${query}`, { token: admin.token });
      expect(res.status, query).toBe(400);
    }
    const ok = await call(
      listAuditLogs,
      "/admin/audit-logs?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00%2B02:00",
      { token: admin.token },
    );
    expect(ok.status).toBe(200);
  });
});
