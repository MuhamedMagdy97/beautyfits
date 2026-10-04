import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchCompany } from "@/app/api/v1/admin/shipping/companies/[id]/route";
import {
  GET as listCompanies,
  POST as createCompany,
} from "@/app/api/v1/admin/shipping/companies/route";
import { PATCH as patchRule } from "@/app/api/v1/admin/shipping/rules/[id]/route";
import { GET as listRules, POST as createRule } from "@/app/api/v1/admin/shipping/rules/route";
import { PUT as chooseDiscount } from "@/app/api/v1/cart/discount/route";
import { POST as addItem } from "@/app/api/v1/cart/items/route";
import { GET as shippingOptions } from "@/app/api/v1/shipping/options/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { SETTING_KEYS } from "@/server/modules/settings/settings";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/** Shipping companies, rules and the shipping quote (TASK-027, Q121–Q126, R37). */

const db = getDb();
const BASE = "http://localhost/api/v1";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    token?: string;
    guest?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "accept-language": "en" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.guest) headers.set("x-guest-cart-token", options.guest);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return (handler as Handler)(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) as Promise<never> },
  );
}

async function data(res: Response, status = 200) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data;
}

async function errorOf(res: Response, status: number) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.error;
}

let counter = 0;

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
    include: { employee: true },
  });
  const created = await createSession(
    db,
    { accountId: account.id, domain: "EMPLOYEE", ttlMs: 12 * MS_PER_HOUR },
    { ip: null, userAgent: null },
    new Date(),
  );
  return { employeeId: account.employee!.id, token: created.tokens.accessToken };
}

/** A guest cart holding one product at `price` piastres. */
async function guestCart(price: number) {
  counter += 1;
  const product = await db.product.create({
    data: {
      nameAr: "منتج",
      nameEn: `Product ${counter}`,
      slug: `product-${counter}`,
      status: "PUBLISHED",
      firstPublishedAt: new Date(),
      variants: { create: { sku: `SKU-${counter}`, isDefault: true, sellingPrice: BigInt(price) } },
    },
    include: { variants: true },
  });
  await db.inventoryMovement.create({
    data: {
      productVariantId: product.variants[0].id,
      movementType: "MANUAL_ADJUSTMENT",
      availableDelta: 5,
      reason: "Test stock",
      createdByType: "SYSTEM",
    },
  });
  const cart = await data(
    await call(addItem, "/cart/items", {
      method: "POST",
      body: { variantId: product.variants[0].id, quantity: 1 },
    }),
  );
  return cart.guestCartToken as string;
}

let manager: { employeeId: string; token: string };
let cairo: { id: string };
let giza: { id: string };
let maadi: { id: string };

function post(handler: unknown, path: string, body: unknown) {
  return call(handler, path, { method: "POST", token: manager.token, body });
}

function patch(handler: unknown, path: string, id: string, body: unknown) {
  return call(handler, `${path}/${id}`, {
    method: "PATCH",
    token: manager.token,
    body,
    params: { id },
  });
}

async function rule(body: Record<string, unknown>) {
  return data(await post(createRule, "/admin/shipping/rules", body), 201);
}

function quote(areaId: string, guest?: string) {
  return call(shippingOptions, `/shipping/options?areaId=${areaId}`, { guest });
}

beforeEach(async () => {
  await resetDatabase();
  manager = await staff("MANAGER", ["SHIPPING_VIEW", "SHIPPING_MANAGE"]);
  cairo = await db.governorate.findUniqueOrThrow({ where: { code: "C" } });
  giza = await db.governorate.findUniqueOrThrow({ where: { code: "GZ" } });
  maadi = await db.area.create({
    data: { governorateId: cairo.id, nameAr: "المعادي", nameEn: "Maadi" },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("admin shipping companies", () => {
  it("needs the shipping permissions", async () => {
    const viewer = await staff("EMPLOYEE", ["SHIPPING_VIEW"]);
    expect((await call(listCompanies, "/admin/shipping/companies")).status).toBe(401);
    expect(
      (await call(listCompanies, "/admin/shipping/companies", { token: viewer.token })).status,
    ).toBe(200);
    const res = await call(createCompany, "/admin/shipping/companies", {
      method: "POST",
      token: viewer.token,
      body: { code: "BOSTA", name: "Bosta" },
    });
    expect((await errorOf(res, 403)).code).toBe("PERMISSION_DENIED");
  });

  it("creates with an uppercase unique code, edits and deactivates, audited", async () => {
    const company = await data(
      await post(createCompany, "/admin/shipping/companies", { code: "bosta", name: "Bosta" }),
      201,
    );
    expect(company).toMatchObject({ code: "BOSTA", contactInfo: null, status: "ACTIVE" });
    const taken = await post(createCompany, "/admin/shipping/companies", {
      code: "Bosta",
      name: "Other",
    });
    expect((await errorOf(taken, 409)).details.reason).toBe("CODE_TAKEN");

    const updated = await data(
      await patch(patchCompany, "/admin/shipping/companies", company.id, {
        status: "INACTIVE",
        contactInfo: "ops@bosta.example",
      }),
    );
    expect(updated).toMatchObject({ status: "INACTIVE", contactInfo: "ops@bosta.example" });
    const active = await data(
      await call(listCompanies, "/admin/shipping/companies?status=ACTIVE", {
        token: manager.token,
      }),
    );
    expect(active).toEqual([]);

    const audits = await db.auditLog.findMany({
      where: { entityId: company.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "SHIPPING_COMPANY_CREATED",
      "SHIPPING_COMPANY_UPDATED",
    ]);
    expect(audits[1].previousDataJson).toMatchObject({ status: "ACTIVE" });

    const unknown = await patch(
      patchCompany,
      "/admin/shipping/companies",
      "019a0000-0000-7000-8000-000000000000",
      { name: "X" },
    );
    expect((await errorOf(unknown, 404)).code).toBe("NOT_FOUND");
  });
});

describe("admin shipping rules", () => {
  it("takes the governorate from the area and validates the rule", async () => {
    const created = await rule({ areaId: maadi.id, shippingFee: 4000 });
    expect(created).toMatchObject({
      governorateId: cairo.id,
      areaId: maadi.id,
      shippingFee: 4000,
      priority: 0,
      status: "ACTIVE",
    });

    const issue = async (body: unknown) =>
      (await errorOf(await post(createRule, "/admin/shipping/rules", body), 400)).details.issues[0];
    expect(await issue({ governorateId: giza.id, areaId: maadi.id, shippingFee: 1 })).toMatchObject(
      {
        path: "areaId",
        code: "other_governorate",
      },
    );
    expect(await issue({ shippingFee: 1, minOrderTotal: 5000, maxOrderTotal: 5000 })).toMatchObject(
      {
        path: "maxOrderTotal",
        code: "below_minimum",
      },
    );
    expect(
      await issue({ shippingFee: 1, shippingCompanyId: "019a0000-0000-7000-8000-000000000000" }),
    ).toMatchObject({ path: "shippingCompanyId", code: "not_found" });
    expect(
      await issue({
        shippingFee: 1,
        activeFrom: "2026-10-05T00:00:00Z",
        activeTo: "2026-10-04T00:00:00Z",
      }),
    ).toMatchObject({ path: "activeTo", code: "before_start" });
    expect((await issue({ shippingFee: -1 })).path).toBe("shippingFee");
  });

  it("edits rules, keeps the area's governorate consistent, audited", async () => {
    const created = await rule({ governorateId: giza.id, shippingFee: 6000 });
    const moved = await data(
      await patch(patchRule, "/admin/shipping/rules", created.id, { areaId: maadi.id }),
    );
    expect(moved).toMatchObject({ governorateId: cairo.id, areaId: maadi.id });
    const mismatch = await patch(patchRule, "/admin/shipping/rules", created.id, {
      governorateId: giza.id,
    });
    expect((await errorOf(mismatch, 400)).details.issues[0].code).toBe("other_governorate");
    const everywhere = await data(
      await patch(patchRule, "/admin/shipping/rules", created.id, {
        areaId: null,
        governorateId: null,
        status: "INACTIVE",
      }),
    );
    expect(everywhere).toMatchObject({ governorateId: null, areaId: null, status: "INACTIVE" });

    const list = await call(listRules, `/admin/shipping/rules?status=INACTIVE`, {
      token: manager.token,
    });
    const body = await list.json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([created.id]);
    expect(body.meta.pagination.total).toBe(1);

    const actions = await db.auditLog.findMany({
      where: { entityId: created.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "SHIPPING_RULE_CREATED",
      "SHIPPING_RULE_UPDATED",
      "SHIPPING_RULE_UPDATED",
    ]);
  });
});

describe("shipping options", () => {
  it("refuses an area without a rule (R37)", async () => {
    await rule({ governorateId: giza.id, shippingFee: 5000 });
    const res = await quote(maadi.id, await guestCart(10_000));
    expect((await errorOf(res, 422)).code).toBe("SHIPPING_UNAVAILABLE");
  });

  it("charges the most specific rule and skips inactive rules and companies", async () => {
    const guest = await guestCart(100_000);
    await rule({ shippingFee: 9000, priority: 10 });
    expect(await data(await quote(maadi.id, guest))).toMatchObject({
      orderTotal: 100_000,
      shippingFee: 9000,
      freeShipping: false,
      freeShippingThreshold: 250_000,
      amountToFreeShipping: 150_000,
      total: 109_000,
      currency: "EGP",
    });

    await rule({ governorateId: cairo.id, shippingFee: 6000 });
    expect((await data(await quote(maadi.id, guest))).shippingFee).toBe(6000);

    const company = await data(
      await post(createCompany, "/admin/shipping/companies", { code: "BOSTA", name: "Bosta" }),
      201,
    );
    const areaRule = await rule({
      areaId: maadi.id,
      shippingFee: 4000,
      shippingCompanyId: company.id,
    });
    expect((await data(await quote(maadi.id, guest))).shippingFee).toBe(4000);

    await patch(patchCompany, "/admin/shipping/companies", company.id, { status: "INACTIVE" });
    expect((await data(await quote(maadi.id, guest))).shippingFee).toBe(6000);
    await patch(patchCompany, "/admin/shipping/companies", company.id, { status: "ACTIVE" });
    await patch(patchRule, "/admin/shipping/rules", areaRule.id, { status: "INACTIVE" });
    expect((await data(await quote(maadi.id, guest))).shippingFee).toBe(6000);
  });

  it("ships free from the threshold on the total after discounts (Q123)", async () => {
    await rule({ shippingFee: 5000 });
    const guest = await guestCart(300_000);
    expect(await data(await quote(maadi.id, guest))).toMatchObject({
      orderTotal: 300_000,
      shippingFee: 0,
      freeShipping: true,
      amountToFreeShipping: 0,
      total: 300_000,
    });

    // 3000 EGP discounted by 20% to 2400 EGP: below the 2500 EGP threshold.
    const discount = await db.discount.create({
      data: {
        nameAr: "خصم",
        nameEn: "Sale",
        value: 20,
        scope: "STORE_WIDE",
        startsAt: new Date(Date.now() - MS_PER_HOUR),
        status: "ACTIVE",
        createdByEmployeeId: manager.employeeId,
      },
    });
    await data(
      await call(chooseDiscount, "/cart/discount", {
        method: "PUT",
        guest,
        body: { discountId: discount.id },
      }),
    );
    expect(await data(await quote(maadi.id, guest))).toMatchObject({
      orderTotal: 240_000,
      shippingFee: 5000,
      freeShipping: false,
      amountToFreeShipping: 10_000,
      total: 245_000,
    });

    await db.setting.create({
      data: {
        key: SETTING_KEYS.shippingFreeShippingThreshold,
        valueJson: 200_000,
        dataType: "INTEGER",
      },
    });
    expect((await data(await quote(maadi.id, guest))).freeShipping).toBe(true);
  });

  it("validates the area", async () => {
    await rule({ shippingFee: 5000 });
    await db.area.update({ where: { id: maadi.id }, data: { status: "INACTIVE" } });
    const inactive = await quote(maadi.id);
    expect((await errorOf(inactive, 400)).details.issues[0].code).toBe("area_inactive");
    const unknown = await quote("019a0000-0000-7000-8000-000000000000");
    expect((await errorOf(unknown, 400)).details.issues[0].code).toBe("area_not_found");
    expect((await errorOf(await quote("nope"), 400)).code).toBe("VALIDATION_ERROR");
  });
});
