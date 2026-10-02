import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchSupplier } from "@/app/api/v1/admin/suppliers/[id]/route";
import { GET as listSuppliers, POST as createSupplier } from "@/app/api/v1/admin/suppliers/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** HTTP-level tests of the admin supplier endpoints (API §21, "TASK-021 Amendments"). */

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
      email: `supplier${counter}@beautyfits.example`,
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

async function data(res: Response, status = 200) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data;
}

const ACME = { name: "Acme Cosmetics", phone: "+20 2 1234 5678", email: "Sales@Acme.example" };

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("suppliers", () => {
  it("reads with SUPPLIER_VIEW and writes with SUPPLIER_MANAGE", async () => {
    expect((await call(listSuppliers, "/admin/suppliers")).status).toBe(401);
    const viewer = await staff("MANAGER", ["SUPPLIER_VIEW"]);
    const manager = await staff("MANAGER", ["SUPPLIER_VIEW", "SUPPLIER_MANAGE"]);
    const created = await data(
      await call(createSupplier, "/admin/suppliers", {
        method: "POST",
        token: manager.token,
        body: ACME,
      }),
      201,
    );
    expect((await call(listSuppliers, "/admin/suppliers", { token: viewer.token })).status).toBe(
      200,
    );
    const denied = [
      await call(createSupplier, "/admin/suppliers", {
        method: "POST",
        token: viewer.token,
        body: ACME,
      }),
      await call(patchSupplier, `/admin/suppliers/${created.id}`, {
        method: "PATCH",
        token: viewer.token,
        body: { notes: "x" },
        params: { id: created.id },
      }),
    ];
    for (const res of denied) {
      expect(res.status).toBe(403);
    }
    const noView = await staff("EMPLOYEE", ["SUPPLIER_MANAGE"]);
    expect((await call(listSuppliers, "/admin/suppliers", { token: noView.token })).status).toBe(
      403,
    );
  });

  it("requires the Origin check for cookie-authenticated writes", async () => {
    const owner = await staff("OWNER");
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    const write = (headers: Record<string, string>) =>
      call(createSupplier, "/admin/suppliers", { method: "POST", headers, body: ACME });
    expect((await write({ cookie })).status).toBe(403);
    expect((await write({ cookie, origin: SAME_ORIGIN })).status).toBe(201);
  });

  it("creates, searches, edits, deactivates and reactivates with audit entries", async () => {
    const owner = await staff("OWNER");
    const created = await data(
      await call(createSupplier, "/admin/suppliers", {
        method: "POST",
        token: owner.token,
        body: ACME,
      }),
      201,
    );
    expect(created).toMatchObject({
      name: "Acme Cosmetics",
      phone: "+20 2 1234 5678",
      email: "sales@acme.example",
      address: null,
      notes: null,
      status: "ACTIVE",
    });
    await data(
      await call(createSupplier, "/admin/suppliers", {
        method: "POST",
        token: owner.token,
        body: { name: "Beta Beauty" },
      }),
      201,
    );

    const edit = (body: unknown) =>
      call(patchSupplier, `/admin/suppliers/${created.id}`, {
        method: "PATCH",
        token: owner.token,
        body,
        params: { id: created.id },
      });
    const edited = await data(await edit({ address: "Cairo", phone: null }));
    expect(edited).toMatchObject({ address: "Cairo", phone: null });
    const inactive = await data(await edit({ status: "INACTIVE" }));
    expect(inactive.status).toBe("INACTIVE");
    // Unchanged values write nothing.
    await data(await edit({ status: "INACTIVE", address: "Cairo" }));

    const search = await call(listSuppliers, "/admin/suppliers?search=acme&status=INACTIVE", {
      token: owner.token,
    });
    const found = await search.json();
    expect(found.data.map((s: { id: string }) => s.id)).toEqual([created.id]);
    expect(found.meta.pagination.total).toBe(1);
    const active = await (
      await call(listSuppliers, "/admin/suppliers?status=ACTIVE", { token: owner.token })
    ).json();
    expect(active.data.map((s: { name: string }) => s.name)).toEqual(["Beta Beauty"]);

    expect((await data(await edit({ status: "ACTIVE" }))).status).toBe("ACTIVE");
    const audits = await db.auditLog.findMany({
      where: { entityType: "SUPPLIER", entityId: created.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "SUPPLIER_CREATED",
      "SUPPLIER_UPDATED",
      "SUPPLIER_UPDATED",
      "SUPPLIER_UPDATED",
    ]);
    expect(audits[2]).toMatchObject({
      previousDataJson: expect.objectContaining({ status: "ACTIVE" }),
      newDataJson: expect.objectContaining({ status: "INACTIVE" }),
    });
  });

  it("refuses duplicate names (any case), bad input and unknown ids", async () => {
    const owner = await staff("OWNER");
    const post = (body: unknown) =>
      call(createSupplier, "/admin/suppliers", { method: "POST", token: owner.token, body });
    const acme = await data(await post(ACME), 201);
    const dup = await post({ name: "ACME cosmetics" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.details.reason).toBe("NAME_TAKEN");

    const other = await data(await post({ name: "Other" }), 201);
    const rename = await call(patchSupplier, `/admin/suppliers/${other.id}`, {
      method: "PATCH",
      token: owner.token,
      body: { name: "acme cosmetics" },
      params: { id: other.id },
    });
    expect(rename.status).toBe(409);
    // Renaming itself (case change only) is fine.
    const self = await call(patchSupplier, `/admin/suppliers/${acme.id}`, {
      method: "PATCH",
      token: owner.token,
      body: { name: "ACME Cosmetics" },
      params: { id: acme.id },
    });
    expect(self.status).toBe(200);

    for (const body of [
      {},
      { name: "" },
      { name: "X", email: "nope" },
      { name: "X", phone: "abc" },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      const res = await call(patchSupplier, `/admin/suppliers/${id}`, {
        method: "PATCH",
        token: owner.token,
        body: { notes: "x" },
        params: { id },
      });
      expect(res.status).toBe(404);
    }
  });

  it("never deletes a supplier", async () => {
    const owner = await staff("OWNER");
    const acme = await data(
      await call(createSupplier, "/admin/suppliers", {
        method: "POST",
        token: owner.token,
        body: ACME,
      }),
      201,
    );
    await expect(db.supplier.delete({ where: { id: acme.id } })).rejects.toThrow();
  });
});
