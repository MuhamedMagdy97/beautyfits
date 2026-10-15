import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approve } from "@/app/api/v1/admin/approval-requests/[id]/approve/route";
import { POST as reject } from "@/app/api/v1/admin/approval-requests/[id]/reject/route";
import { GET as listAuditLogs } from "@/app/api/v1/admin/audit-logs/route";
import { PATCH as changeSetting } from "@/app/api/v1/admin/settings/[key]/route";
import { GET as listHistory } from "@/app/api/v1/admin/settings/history/route";
import { GET as listSettings } from "@/app/api/v1/admin/settings/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import {
  readFreeShippingThreshold,
  readGuestCartExpiryDays,
  SETTING_KEYS,
} from "@/server/modules/settings/settings";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of the settings endpoints (API §26, "TASK-057 Amendments", ADR-0054). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const THRESHOLD = SETTING_KEYS.shippingFreeShippingThreshold;
const CART_DAYS = SETTING_KEYS.cartGuestExpiryDays;

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers();
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

function patch(token: string, key: string, body: unknown) {
  return call(changeSetting, `/admin/settings/${key}`, {
    method: "PATCH",
    token,
    body,
    params: { key },
  });
}

function resolve(handler: unknown, token: string, id: string, body: unknown = {}) {
  return call(handler, `/admin/approval-requests/${id}/x`, {
    method: "POST",
    token,
    body,
    params: { id },
  });
}

let counter = 0;

async function staff(level: EmployeeLevel, codes: PermissionCode[] = []) {
  counter += 1;
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: `settings${counter}@beautyfits.example`,
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
                          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
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

async function settingOf(token: string, key: string) {
  const body = await (await call(listSettings, "/admin/settings", { token })).json();
  return body.data.find((s: { key: string }) => s.key === key);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("permissions", () => {
  it("lets SETTINGS_VIEW read but keeps changes to Owner/Admin", async () => {
    expect((await call(listSettings, "/admin/settings")).status).toBe(401);
    const manager = await staff("MANAGER", ["SETTINGS_VIEW", "SETTINGS_MANAGE"]);
    expect((await call(listSettings, "/admin/settings", { token: manager.token })).status).toBe(
      200,
    );
    expect(
      (await call(listHistory, "/admin/settings/history", { token: manager.token })).status,
    ).toBe(200);
    const res = await patch(manager.token, CART_DAYS, { value: 10 });
    expect(res.status).toBe(403);
    const nobody = await staff("EMPLOYEE");
    expect((await call(listSettings, "/admin/settings", { token: nobody.token })).status).toBe(403);
  });
});

describe("non-critical settings", () => {
  it("lists every setting with its default on an empty table", async () => {
    const owner = await staff("OWNER");
    const setting = await settingOf(owner.token, THRESHOLD);
    expect(setting).toMatchObject({
      key: THRESHOLD,
      dataType: "INTEGER",
      value: 250_000,
      defaultValue: 250_000,
      critical: true,
      unit: "PIASTRES",
      updatedBy: null,
      pendingApproval: null,
    });
    expect(await settingOf(owner.token, CART_DAYS)).toMatchObject({ critical: false });
    expect(await settingOf(owner.token, SETTING_KEYS.pricingMinMarginBasisPoints)).toMatchObject({
      critical: true,
    });
  });

  it("applies at once with history and an audit entry", async () => {
    const admin = await staff("ADMIN");
    const res = await patch(admin.token, CART_DAYS, { value: 14, reason: "Shorter carts" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      outcome: "APPLIED",
      approvalRequestId: null,
      setting: { key: CART_DAYS, value: 14, updatedBy: { id: admin.employee.id } },
    });
    expect(await readGuestCartExpiryDays(db)).toBe(14);

    const history = await (
      await call(listHistory, `/admin/settings/history?key=${CART_DAYS}`, { token: admin.token })
    ).json();
    expect(history.data).toHaveLength(1);
    expect(history.data[0]).toMatchObject({
      key: CART_DAYS,
      oldValue: 30,
      newValue: 14,
      changedBy: { id: admin.employee.id },
      approvedBy: null,
    });

    const audit = await (
      await call(listAuditLogs, `/admin/audit-logs?entityType=SETTING&entityId=${CART_DAYS}`, {
        token: admin.token,
      })
    ).json();
    expect(audit.data).toHaveLength(1);
    expect(audit.data[0]).toMatchObject({
      action: "SETTING_CHANGED",
      previousData: { value: 30 },
      newData: { value: 14, critical: false },
      reason: "Shorter carts",
      correlationId: res.headers.get("x-request-id"),
    });

    // The same value again changes nothing.
    const same = await patch(admin.token, CART_DAYS, { value: 14 });
    expect((await same.json()).data.outcome).toBe("UNCHANGED");
    expect(await db.settingHistory.count()).toBe(1);
  });

  it("refuses invalid values and unknown keys", async () => {
    const owner = await staff("OWNER");
    for (const value of [0, -1, 1.5, "30", true]) {
      const res = await patch(owner.token, CART_DAYS, { value });
      expect(res.status).toBe(400);
    }
    const channel = await patch(owner.token, SETTING_KEYS.codConfirmationChannel, {
      value: "EMAIL",
    });
    expect(channel.status).toBe(400);
    expect((await patch(owner.token, "no.such_key", { value: 1 })).status).toBe(404);
    expect(await db.settingHistory.count()).toBe(0);
  });
});

describe("critical settings", () => {
  it("waits for another Owner/Admin's approval, then applies", async () => {
    const owner = await staff("OWNER");
    const admin = await staff("ADMIN");
    const res = await patch(owner.token, THRESHOLD, { value: 300_000, reason: "New policy" });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body).toMatchObject({
      outcome: "PENDING_APPROVAL",
      setting: {
        value: 250_000,
        pendingApproval: { value: 300_000, requestedBy: { id: owner.employee.id } },
      },
    });
    expect(await readFreeShippingThreshold(db)).toBe(BigInt(250_000));

    const second = await patch(admin.token, THRESHOLD, { value: 200_000 });
    expect(second.status).toBe(409);
    expect((await second.json()).error.details).toMatchObject({ reason: "APPROVAL_PENDING" });

    const own = await resolve(approve, owner.token, body.approvalRequestId);
    expect(own.status).toBe(403);

    const approved = await resolve(approve, admin.token, body.approvalRequestId);
    expect(approved.status).toBe(200);
    expect(await readFreeShippingThreshold(db)).toBe(BigInt(300_000));

    const history = await db.settingHistory.findMany();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      settingKey: THRESHOLD,
      oldValueJson: 250_000,
      newValueJson: 300_000,
      changedByEmployeeId: owner.employee.id,
      approvedByEmployeeId: admin.employee.id,
    });
    const audit = await db.auditLog.findMany({ where: { action: "SETTING_CHANGED" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: admin.employee.id, entityId: THRESHOLD });
    expect((await settingOf(owner.token, THRESHOLD)).pendingApproval).toBeNull();
  });

  it("applies at once for a sole Owner, recording that approval was skipped", async () => {
    const owner = await staff("OWNER");
    const formerAdmin = await staff("ADMIN");
    await db.employee.update({
      where: { id: formerAdmin.employee.id },
      data: { status: "DEACTIVATED" },
    });
    const res = await patch(owner.token, THRESHOLD, { value: 300_000, reason: "Only owner" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ outcome: "APPLIED", approvalRequestId: null });
    expect(await readFreeShippingThreshold(db)).toBe(BigInt(300_000));
    expect(await db.approvalRequest.count()).toBe(0);
    const history = await db.settingHistory.findFirstOrThrow();
    expect(history).toMatchObject({
      changedByEmployeeId: owner.employee.id,
      approvedByEmployeeId: null,
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "SETTING_CHANGED" } });
    expect(audit.newDataJson).toMatchObject({ critical: true, approvalSkipped: "SOLE_OWNER" });
  });

  it("still needs approval when the requester is an Admin, even with one Owner", async () => {
    await staff("OWNER");
    const admin = await staff("ADMIN");
    const res = await patch(admin.token, THRESHOLD, { value: 300_000 });
    expect((await res.json()).data.outcome).toBe("PENDING_APPROVAL");
  });

  it("changes nothing when rejected", async () => {
    const owner = await staff("OWNER");
    const admin = await staff("ADMIN");
    const body = (
      await (
        await patch(admin.token, SETTING_KEYS.codConfirmationTimeoutHours, { value: 48 })
      ).json()
    ).data;
    expect(body.outcome).toBe("PENDING_APPROVAL");
    const rejected = await resolve(reject, owner.token, body.approvalRequestId, {
      reason: "Keep 72",
    });
    expect(rejected.status).toBe(200);
    expect(await db.settingHistory.count()).toBe(0);
    expect((await settingOf(owner.token, SETTING_KEYS.codConfirmationTimeoutHours)).value).toBe(72);
  });

  it("refuses an approval when the value changed since the request", async () => {
    const owner = await staff("OWNER");
    const admin = await staff("ADMIN");
    const body = (await (await patch(owner.token, THRESHOLD, { value: 300_000 })).json()).data;
    await db.setting.create({
      data: { key: THRESHOLD, valueJson: 260_000, dataType: "INTEGER" },
    });
    const res = await resolve(approve, admin.token, body.approvalRequestId);
    expect(res.status).toBe(409);
    expect((await res.json()).error.details).toMatchObject({ reason: "SETTING_CHANGED_SINCE" });
    const request = await db.approvalRequest.findUniqueOrThrow({
      where: { id: body.approvalRequestId },
    });
    expect(request.status).toBe("PENDING");
    expect(await readFreeShippingThreshold(db)).toBe(BigInt(260_000));
  });
});
