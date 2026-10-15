import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as adminCustomer } from "@/app/api/v1/admin/customers/[id]/route";
import { GET as adminCustomers } from "@/app/api/v1/admin/customers/route";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";
import { bareOrder } from "@/test/integration/orders";

/** Staff customer reads (TASK-054, API "TASK-002A Amendments", Q80, ADR-0063). */

const db = getDb();
const BASE = "http://localhost/api/v1";
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<Response> {
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${token}`, "accept-language": "en" },
    }),
    { params: Promise.resolve(params) as Promise<never> },
  );
}

async function body(res: Response, status = 200) {
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(status);
  return json;
}

let counter = 0;
let areaId: string;

async function customer(fullName: string) {
  counter += 1;
  const now = new Date();
  const account = await db.account.create({
    data: {
      accountType: "CUSTOMER",
      email: `c${counter}@example.com`,
      emailVerifiedAt: now,
      passwordHash: "unused",
      status: "ACTIVE",
      customer: {
        create: {
          phone: `+2010${10000000 + counter}`,
          phoneVerifiedAt: now,
          fullName,
          dateOfBirth: new Date("1990-01-01"),
          addresses: {
            create: [
              { recipientName: fullName, phone: "+201012345678", areaId, street: "9 Road 9" },
            ],
          },
        },
      },
    },
    include: { customer: true },
  });
  return account.customer!;
}

async function staff(codes: PermissionCode[]) {
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
          employeeLevel: "EMPLOYEE",
          roles: {
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
          },
        },
      },
    },
  });
  const created = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return created.tokens.accessToken;
}

beforeEach(async () => {
  await resetDatabase();
  const cairo = await db.governorate.findUniqueOrThrow({ where: { code: "C" } });
  areaId = (
    await db.area.create({ data: { governorateId: cairo.id, nameAr: "المعادي", nameEn: "Maadi" } })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /admin/customers", () => {
  it("lists customers newest first, searches by name, and hides contact data without VIEW_CUSTOMER_CONTACT", async () => {
    const sara = await customer("Sara Ali");
    const mona = await customer("Mona Hassan");
    await bareOrder(sara.id);
    const token = await staff(["CUSTOMER_VIEW"]);

    const all = await body(await call(adminCustomers, "/admin/customers", token));
    expect(all.data.map((c: { id: string }) => c.id)).toEqual([mona.id, sara.id]);
    expect(all.meta.pagination).toMatchObject({ page: 1, total: 2 });
    expect(all.data[1]).toEqual({
      id: sara.id,
      fullName: "Sara Ali",
      accountStatus: "ACTIVE",
      anonymized: false,
      orderCount: 1,
      createdAt: sara.createdAt.toISOString(),
    });

    const found = await body(await call(adminCustomers, "/admin/customers?search=sara", token));
    expect(found.data.map((c: { id: string }) => c.id)).toEqual([sara.id]);

    const denied = await body(
      await call(adminCustomers, `/admin/customers?phone=${encodeURIComponent(sara.phone)}`, token),
      403,
    );
    expect(denied.error.code).toBe("PERMISSION_DENIED");
  });

  it("shows phone and email and filters by phone with VIEW_CUSTOMER_CONTACT", async () => {
    const sara = await customer("Sara");
    await customer("Mona");
    const token = await staff(["CUSTOMER_VIEW", "VIEW_CUSTOMER_CONTACT"]);
    const found = await body(
      await call(adminCustomers, `/admin/customers?phone=${encodeURIComponent(sara.phone)}`, token),
    );
    expect(found.data).toHaveLength(1);
    expect(found.data[0]).toMatchObject({
      id: sara.id,
      phone: sara.phone,
      email: expect.any(String),
    });
  });

  it("needs CUSTOMER_VIEW", async () => {
    const token = await staff(["ORDERS_VIEW"]);
    const res = await body(await call(adminCustomers, "/admin/customers", token), 403);
    expect(res.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("GET /admin/customers/{id}", () => {
  it("returns the profile and latest orders; contact data only with VIEW_CUSTOMER_CONTACT", async () => {
    const sara = await customer("Sara");
    const orderId = await bareOrder(sara.id);
    const plain = await staff(["CUSTOMER_VIEW"]);

    const view = (await body(await call(adminCustomer, "", plain, { id: sara.id }))).data;
    expect(view).toMatchObject({
      id: sara.id,
      fullName: "Sara",
      accountStatus: "ACTIVE",
      phoneVerified: true,
      emailVerified: true,
      anonymizedAt: null,
      orderCount: 1,
      orders: [{ id: orderId, status: "PENDING_CONFIRMATION", total: 10000 }],
    });
    expect(view).not.toHaveProperty("phone");
    expect(view).not.toHaveProperty("email");
    expect(view).not.toHaveProperty("addresses");
    expect(view).not.toHaveProperty("dateOfBirth");

    const contact = await staff(["CUSTOMER_VIEW", "VIEW_CUSTOMER_CONTACT"]);
    const full = (await body(await call(adminCustomer, "", contact, { id: sara.id }))).data;
    expect(full.phone).toBe(sara.phone);
    expect(full.email).toMatch(/@example\.com$/);
    expect(full.addresses).toEqual([
      expect.objectContaining({
        street: "9 Road 9",
        area: expect.objectContaining({ name: "Maadi" }),
      }),
    ]);
    expect(full).not.toHaveProperty("dateOfBirth");
  });

  it("answers 404 for an unknown or malformed id and 403 without CUSTOMER_VIEW", async () => {
    const token = await staff(["CUSTOMER_VIEW"]);
    expect(
      (await body(await call(adminCustomer, "", token, { id: UNKNOWN_ID }), 404)).error.code,
    ).toBe("NOT_FOUND");
    expect((await body(await call(adminCustomer, "", token, { id: "nope" }), 404)).error.code).toBe(
      "NOT_FOUND",
    );
    const other = await staff(["ORDERS_VIEW"]);
    expect(
      (await body(await call(adminCustomer, "", other, { id: UNKNOWN_ID }), 403)).error.code,
    ).toBe("PERMISSION_DENIED");
  });
});
