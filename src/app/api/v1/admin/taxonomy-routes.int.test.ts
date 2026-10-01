import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchBrand } from "@/app/api/v1/admin/brands/[id]/route";
import { GET as listBrands, POST as createBrand } from "@/app/api/v1/admin/brands/route";
import { PATCH as patchCategory } from "@/app/api/v1/admin/categories/[id]/route";
import { GET as listCategories, POST as createCategory } from "@/app/api/v1/admin/categories/route";
import {
  GET as productDetail,
  PATCH as patchProduct,
} from "@/app/api/v1/admin/products/[id]/route";
import { GET as listProducts, POST as createProduct } from "@/app/api/v1/admin/products/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of the admin brand and category endpoints and the product
 * brand/category links (API contract §13, "TASK-015 Amendments").
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
      email: `taxonomy${counter}@beautyfits.example`,
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

/** The Catalog Editor default role (permission catalog §3). */
const CATALOG_EDITOR: PermissionCode[] = [
  "PRODUCT_VIEW",
  "PRODUCT_CREATE",
  "PRODUCT_EDIT",
  "MANAGE_PRODUCT_MEDIA",
  "TAXONOMY_MANAGE",
];

async function post(handler: unknown, path: string, token: string, body: unknown) {
  return call(handler, path, { method: "POST", token, body });
}

async function patch(handler: unknown, path: string, id: string, token: string, body: unknown) {
  return call(handler, path, { method: "PATCH", token, body, params: { id } });
}

async function data(res: Response, status = 200) {
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data;
}

const MAYBELLINE = { nameAr: "ميبيلين", nameEn: "Maybelline New York" };

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("permission checks", () => {
  it("answers 401 without a session", async () => {
    expect((await call(listBrands, "/admin/brands")).status).toBe(401);
    expect((await call(listCategories, "/admin/categories")).status).toBe(401);
  });

  it("reads with PRODUCT_VIEW and writes with TAXONOMY_MANAGE", async () => {
    const viewer = await staff("EMPLOYEE", ["PRODUCT_VIEW", "PRODUCT_EDIT"]);
    const editor = await staff("EMPLOYEE", ["PRODUCT_VIEW", "TAXONOMY_MANAGE"]);
    const brand = await data(
      await post(createBrand, "/admin/brands", editor.token, MAYBELLINE),
      201,
    );
    const makeup = await data(
      await post(createCategory, "/admin/categories", editor.token, {
        nameAr: "مكياج",
        nameEn: "Makeup",
      }),
      201,
    );
    expect((await call(listBrands, "/admin/brands", { token: viewer.token })).status).toBe(200);
    expect((await call(listCategories, "/admin/categories", { token: viewer.token })).status).toBe(
      200,
    );

    const denied = [
      await post(createBrand, "/admin/brands", viewer.token, { nameAr: "س", nameEn: "X" }),
      await patch(patchBrand, `/admin/brands/${brand.id}`, brand.id, viewer.token, { nameEn: "X" }),
      await post(createCategory, "/admin/categories", viewer.token, { nameAr: "س", nameEn: "X" }),
      await patch(patchCategory, `/admin/categories/${makeup.id}`, makeup.id, viewer.token, {
        nameEn: "X",
      }),
    ];
    for (const res of denied) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("PERMISSION_DENIED");
    }
    const noView = await staff("EMPLOYEE", ["TAXONOMY_MANAGE"]);
    expect((await call(listBrands, "/admin/brands", { token: noView.token })).status).toBe(403);
  });

  it("requires the Origin check for cookie-authenticated writes", async () => {
    const owner = await staff("OWNER");
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    const noOrigin = await call(createBrand, "/admin/brands", {
      method: "POST",
      headers: { cookie },
      body: MAYBELLINE,
    });
    expect(noOrigin.status).toBe(403);
    const sameOrigin = await call(createBrand, "/admin/brands", {
      method: "POST",
      headers: { cookie, origin: SAME_ORIGIN },
      body: MAYBELLINE,
    });
    expect(sameOrigin.status).toBe(201);
  });
});

describe("brands", () => {
  it("creates, lists, edits and deactivates brands with audit entries", async () => {
    const owner = await staff("OWNER");
    const res = await call(createBrand, "/admin/brands", {
      method: "POST",
      token: owner.token,
      headers: { "x-request-id": "req-brand-1" },
      body: { ...MAYBELLINE, descriptionEn: "  " },
    });
    const brand = await data(res, 201);
    expect(brand).toMatchObject({
      nameEn: "Maybelline New York",
      slug: "maybelline-new-york",
      descriptionEn: null,
      status: "ACTIVE",
      productCount: 0,
    });
    const created = await db.auditLog.findFirstOrThrow({ where: { action: "BRAND_CREATED" } });
    expect(created).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: owner.employee.id,
      entityType: "BRAND",
      entityId: brand.id,
      correlationId: "req-brand-1",
    });

    const taken = await post(createBrand, "/admin/brands", owner.token, MAYBELLINE);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.details).toMatchObject({ reason: "SLUG_TAKEN" });

    const arabicOnly = await post(createBrand, "/admin/brands", owner.token, {
      nameAr: "ماركة",
      nameEn: "ماركة",
    });
    expect(arabicOnly.status).toBe(400);
    expect(JSON.stringify(await arabicOnly.json())).toContain("slug_required");

    await data(
      await post(createBrand, "/admin/brands", owner.token, { nameAr: "لوريال", nameEn: "LOreal" }),
      201,
    );
    const all = await call(listBrands, "/admin/brands", { token: owner.token });
    const allBody = await all.json();
    expect(allBody.data.map((b: { slug: string }) => b.slug)).toEqual([
      "loreal",
      "maybelline-new-york",
    ]);
    expect(allBody.meta.pagination).toMatchObject({ total: 2 });
    const searched = await data(
      await call(listBrands, "/admin/brands?search=ميبي", { token: owner.token }),
    );
    expect(searched).toHaveLength(1);

    const off = await data(
      await patch(patchBrand, `/admin/brands/${brand.id}`, brand.id, owner.token, {
        status: "INACTIVE",
        slug: "maybelline",
      }),
    );
    expect(off).toMatchObject({ status: "INACTIVE", slug: "maybelline" });
    // Repeating the same change writes nothing.
    await patch(patchBrand, `/admin/brands/${brand.id}`, brand.id, owner.token, {
      status: "INACTIVE",
    });
    const updates = await db.auditLog.findMany({ where: { action: "BRAND_UPDATED" } });
    expect(updates).toHaveLength(1);
    expect(updates[0].previousDataJson).toMatchObject({ status: "ACTIVE" });
    expect(updates[0].newDataJson).toMatchObject({ status: "INACTIVE" });

    const inactive = await data(
      await call(listBrands, "/admin/brands?status=INACTIVE", { token: owner.token }),
    );
    expect(inactive.map((b: { id: string }) => b.id)).toEqual([brand.id]);

    const back = await data(
      await patch(patchBrand, `/admin/brands/${brand.id}`, brand.id, owner.token, {
        status: "ACTIVE",
      }),
    );
    expect(back.status).toBe("ACTIVE");
  });

  it("answers 404 for an unknown or malformed brand id", async () => {
    const owner = await staff("OWNER");
    for (const id of [UNKNOWN_ID, "nope"]) {
      const res = await patch(patchBrand, `/admin/brands/${id}`, id, owner.token, { nameEn: "X" });
      expect(res.status).toBe(404);
    }
  });
});

describe("categories", () => {
  it("builds a tree, moves and deactivates categories with audit entries", async () => {
    const owner = await staff("OWNER");
    const makeup = await data(
      await post(createCategory, "/admin/categories", owner.token, {
        nameAr: "مكياج",
        nameEn: "Makeup",
      }),
      201,
    );
    expect(makeup).toMatchObject({ slug: "makeup", parentId: null, depth: 1, status: "ACTIVE" });
    const lips = await data(
      await post(createCategory, "/admin/categories", owner.token, {
        nameAr: "شفاه",
        nameEn: "Lips",
        parentId: makeup.id,
      }),
      201,
    );
    expect(lips).toMatchObject({ parentId: makeup.id, depth: 2 });

    const unknownParent = await post(createCategory, "/admin/categories", owner.token, {
      nameAr: "س",
      nameEn: "X",
      parentId: UNKNOWN_ID,
    });
    expect(unknownParent.status).toBe(400);
    expect(JSON.stringify(await unknownParent.json())).toContain("category_not_found");

    const blocked = await patch(
      patchCategory,
      `/admin/categories/${makeup.id}`,
      makeup.id,
      owner.token,
      {
        status: "INACTIVE",
      },
    );
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.details).toMatchObject({
      reason: "CATEGORY_HAS_ACTIVE_CHILDREN",
    });

    const moved = await data(
      await patch(patchCategory, `/admin/categories/${lips.id}`, lips.id, owner.token, {
        parentId: null,
      }),
    );
    expect(moved).toMatchObject({ parentId: null, depth: 1 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "CATEGORY_UPDATED" } });
    expect(audit).toMatchObject({ entityType: "CATEGORY", entityId: lips.id });
    expect(audit.previousDataJson).toMatchObject({ parentId: makeup.id });
    expect(audit.newDataJson).toMatchObject({ parentId: null });

    await data(
      await patch(patchCategory, `/admin/categories/${makeup.id}`, makeup.id, owner.token, {
        status: "INACTIVE",
      }),
    );
    const active = await data(
      await call(listCategories, "/admin/categories?status=ACTIVE", { token: owner.token }),
    );
    expect(active.map((c: { id: string }) => c.id)).toEqual([lips.id]);
    const all = await data(await call(listCategories, "/admin/categories", { token: owner.token }));
    expect(all).toHaveLength(2);
    expect(await db.auditLog.count({ where: { action: "CATEGORY_CREATED" } })).toBe(2);
  });
});

describe("product brand and categories", () => {
  it("links a product to a brand and categories, filters and audits them", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const brand = await data(
      await post(createBrand, "/admin/brands", editor.token, MAYBELLINE),
      201,
    );
    const makeup = await data(
      await post(createCategory, "/admin/categories", editor.token, {
        nameAr: "مكياج",
        nameEn: "Makeup",
      }),
      201,
    );
    const lips = await data(
      await post(createCategory, "/admin/categories", editor.token, {
        nameAr: "شفاه",
        nameEn: "Lips",
        parentId: makeup.id,
      }),
      201,
    );
    const product = await data(
      await post(createProduct, "/admin/products", editor.token, {
        nameAr: "أحمر شفاه",
        nameEn: "Lipstick",
        brandId: brand.id,
        categoryIds: [makeup.id, lips.id, lips.id],
        defaultVariant: { sku: "LIP-1" },
      }),
      201,
    );
    expect(product.brand).toEqual({
      id: brand.id,
      nameAr: brand.nameAr,
      nameEn: brand.nameEn,
      slug: brand.slug,
      status: "ACTIVE",
    });
    expect(product.categories.map((c: { id: string }) => c.id)).toEqual([lips.id, makeup.id]);
    expect(product.categories[0]).toMatchObject({ parentId: makeup.id });
    const createdAudit = await db.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_CREATED" },
    });
    expect(createdAudit.newDataJson).toMatchObject({
      brandId: brand.id,
      categoryIds: [makeup.id, lips.id].sort(),
    });

    await data(
      await post(createProduct, "/admin/products", editor.token, {
        nameAr: "منتج",
        nameEn: "Other",
        defaultVariant: { sku: "OTHER-1" },
      }),
      201,
    );
    const byBrand = await data(
      await call(listProducts, `/admin/products?brandId=${brand.id}`, { token: editor.token }),
    );
    expect(byBrand.map((p: { id: string }) => p.id)).toEqual([product.id]);
    expect(byBrand[0].brand).toMatchObject({ id: brand.id });
    const byCategory = await data(
      await call(listProducts, `/admin/products?categoryId=${lips.id}`, { token: editor.token }),
    );
    expect(byCategory.map((p: { id: string }) => p.id)).toEqual([product.id]);

    const brands = await data(await call(listBrands, "/admin/brands", { token: editor.token }));
    expect(brands[0].productCount).toBe(1);

    const changed = await data(
      await patch(patchProduct, `/admin/products/${product.id}`, product.id, editor.token, {
        brandId: null,
        categoryIds: [lips.id],
      }),
    );
    expect(changed.brand).toBeNull();
    expect(changed.categories.map((c: { id: string }) => c.id)).toEqual([lips.id]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PRODUCT_UPDATED" } });
    expect(audit.previousDataJson).toMatchObject({ brandId: brand.id });
    expect(audit.newDataJson).toMatchObject({ brandId: null, categoryIds: [lips.id] });

    // The same list again changes nothing.
    await patch(patchProduct, `/admin/products/${product.id}`, product.id, editor.token, {
      categoryIds: [lips.id],
    });
    expect(await db.auditLog.count({ where: { action: "PRODUCT_UPDATED" } })).toBe(1);

    const detail = await data(
      await call(productDetail, `/admin/products/${product.id}`, {
        token: editor.token,
        params: { id: product.id },
      }),
    );
    expect(detail.categories).toHaveLength(1);
  });

  it("refuses unknown and inactive brands and categories", async () => {
    const owner = await staff("OWNER");
    const brand = await data(
      await post(createBrand, "/admin/brands", owner.token, MAYBELLINE),
      201,
    );
    await patch(patchBrand, `/admin/brands/${brand.id}`, brand.id, owner.token, {
      status: "INACTIVE",
    });
    const base = { nameAr: "منتج", nameEn: "Base", defaultVariant: { sku: "BASE-1" } };

    const unknownBrand = await post(createProduct, "/admin/products", owner.token, {
      ...base,
      brandId: UNKNOWN_ID,
    });
    expect(unknownBrand.status).toBe(400);
    expect(JSON.stringify(await unknownBrand.json())).toContain("brand_not_found");

    const unknownCategory = await post(createProduct, "/admin/products", owner.token, {
      ...base,
      categoryIds: [UNKNOWN_ID],
    });
    expect(unknownCategory.status).toBe(400);
    expect(JSON.stringify(await unknownCategory.json())).toContain("category_not_found");

    const inactive = await post(createProduct, "/admin/products", owner.token, {
      ...base,
      brandId: brand.id,
    });
    expect(inactive.status).toBe(409);
    expect((await inactive.json()).error.details).toMatchObject({ reason: "BRAND_INACTIVE" });
    expect(await db.product.count()).toBe(0);
  });
});
