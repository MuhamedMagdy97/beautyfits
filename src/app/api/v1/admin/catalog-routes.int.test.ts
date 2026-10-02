import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  GET as productDetail,
  PATCH as patchProduct,
} from "@/app/api/v1/admin/products/[id]/route";
import {
  GET as listVariants,
  POST as addVariant,
} from "@/app/api/v1/admin/products/[id]/variants/route";
import { GET as listProducts, POST as createProduct } from "@/app/api/v1/admin/products/route";
import { POST as archiveVariant } from "@/app/api/v1/admin/variants/[id]/archive/route";
import { PATCH as patchVariant } from "@/app/api/v1/admin/variants/[id]/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of the admin product and variant endpoints (API contract
 * §13, "TASK-014 Amendments").
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
      email: `catalog${counter}@beautyfits.example`,
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

const LIPSTICK = {
  nameAr: "أحمر شفاه مطفي",
  nameEn: "Matte Lipstick",
  descriptionEn: "Long-lasting colour.",
  defaultVariant: {
    sku: "lip-matte-01",
    nameAr: "وردي",
    nameEn: "Rose",
    attributes: { shade: "Rose" },
  },
};

async function create(token: string, body: unknown = LIPSTICK) {
  return call(createProduct, "/admin/products", { method: "POST", token, body });
}

async function createOk(token: string, body: unknown = LIPSTICK) {
  const res = await create(token, body);
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("permission checks", () => {
  it("answers 401 without a session", async () => {
    expect((await call(listProducts, "/admin/products")).status).toBe(401);
    expect(
      (await call(createProduct, "/admin/products", { method: "POST", body: LIPSTICK })).status,
    ).toBe(401);
  });

  it("requires the permission of each endpoint", async () => {
    const viewer = await staff("EMPLOYEE", ["PRODUCT_VIEW"]);
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await createOk(editor.token);
    const other = await call(addVariant, `/admin/products/${product.id}/variants`, {
      method: "POST",
      token: editor.token,
      body: { sku: "LIP-MATTE-02", nameAr: "أحمر", nameEn: "Red" },
      params: { id: product.id },
    });
    const variantId = (await other.json()).data.id;

    const denied = [
      await create(viewer.token),
      await call(patchProduct, `/admin/products/${product.id}`, {
        method: "PATCH",
        token: viewer.token,
        body: { nameEn: "X" },
        params: { id: product.id },
      }),
      await call(addVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: viewer.token,
        body: { sku: "X" },
        params: { id: product.id },
      }),
      await call(patchVariant, `/admin/variants/${variantId}`, {
        method: "PATCH",
        token: viewer.token,
        body: { nameEn: "X", nameAr: "س" },
        params: { id: variantId },
      }),
      // PRODUCT_ARCHIVE is in no default role (permission catalog §3).
      await call(archiveVariant, `/admin/variants/${variantId}/archive`, {
        method: "POST",
        token: editor.token,
        params: { id: variantId },
      }),
    ];
    for (const res of denied) {
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("PERMISSION_DENIED");
    }

    const allowed = await call(productDetail, `/admin/products/${product.id}`, {
      token: viewer.token,
      params: { id: product.id },
    });
    expect(allowed.status).toBe(200);
  });

  it("requires the Origin check for cookie-authenticated writes", async () => {
    const owner = await staff("OWNER");
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    const options = { method: "POST", body: LIPSTICK };
    const blocked = await call(createProduct, "/admin/products", {
      ...options,
      headers: { cookie },
    });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("FORBIDDEN");
    const allowed = await call(createProduct, "/admin/products", {
      ...options,
      headers: { cookie, origin: SAME_ORIGIN },
    });
    expect(allowed.status).toBe(201);
  });
});

describe("POST /admin/products", () => {
  it("creates a draft product with exactly one default variant and audits it", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const res = await call(createProduct, "/admin/products", {
      method: "POST",
      token: editor.token,
      headers: { "x-request-id": "req-create-product-1" },
      body: { ...LIPSTICK, status: "PUBLISHED" },
    });
    expect(res.status).toBe(201);
    const product = (await res.json()).data;
    expect(product).toMatchObject({
      nameAr: LIPSTICK.nameAr,
      nameEn: "Matte Lipstick",
      slug: "matte-lipstick",
      descriptionAr: null,
      descriptionEn: "Long-lasting colour.",
      status: "DRAFT",
      archivedAt: null,
    });
    expect(product.variants).toEqual([
      expect.objectContaining({
        productId: product.id,
        sku: "LIP-MATTE-01",
        isDefault: true,
        nameAr: "وردي",
        nameEn: "Rose",
        attributes: { shade: "Rose" },
        status: "ACTIVE",
      }),
    ]);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PRODUCT_CREATED" } });
    expect(audit).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: editor.employee.id,
      entityType: "PRODUCT",
      entityId: product.id,
      correlationId: "req-create-product-1",
    });
    expect(audit.newDataJson).toMatchObject({
      slug: "matte-lipstick",
      status: "DRAFT",
      defaultVariant: { sku: "LIP-MATTE-01", isDefault: true },
    });
  });

  it("refuses a taken slug or SKU and writes nothing", async () => {
    const owner = await staff("OWNER");
    await createOk(owner.token);

    const slugClash = await create(owner.token, {
      ...LIPSTICK,
      defaultVariant: { sku: "OTHER-1" },
    });
    expect(slugClash.status).toBe(409);
    expect((await slugClash.json()).error.details).toMatchObject({
      reason: "SLUG_TAKEN",
      slug: "matte-lipstick",
    });

    const skuClash = await create(owner.token, {
      ...LIPSTICK,
      slug: "matte-lipstick-2",
      defaultVariant: { sku: "Lip-Matte-01" },
    });
    expect(skuClash.status).toBe(409);
    expect((await skuClash.json()).error.details).toMatchObject({
      reason: "SKU_TAKEN",
      sku: "LIP-MATTE-01",
    });

    expect(await db.product.count()).toBe(1);
    expect(await db.productVariant.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: "PRODUCT_CREATED" } })).toBe(1);
  });

  it("asks for a slug when the English name has no Latin letters", async () => {
    const owner = await staff("OWNER");
    const res = await create(owner.token, { ...LIPSTICK, nameEn: "٫٫" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.details.issues[0]).toMatchObject({
      path: "slug",
      code: "slug_required",
    });
  });

  it("validates the body", async () => {
    const owner = await staff("OWNER");
    const res = await create(owner.token, {
      ...LIPSTICK,
      defaultVariant: { sku: "bad sku", nameEn: "Rose" },
    });
    expect(res.status).toBe(400);
    const paths = (await res.json()).error.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["defaultVariant.sku"]));
  });
});

describe("GET /admin/products", () => {
  it("lists newest first, filters by status and searches names, slug and SKU", async () => {
    const owner = await staff("OWNER");
    const first = await createOk(owner.token);
    const second = await createOk(owner.token, {
      nameAr: "كريم مرطب",
      nameEn: "Hydrating Cream",
      defaultVariant: { sku: "CREAM-50ML" },
    });
    await call(addVariant, `/admin/products/${second.id}/variants`, {
      method: "POST",
      token: owner.token,
      body: { sku: "CREAM-100ML", nameAr: "١٠٠ مل", nameEn: "100 ml" },
      params: { id: second.id },
    });

    const all = await (await call(listProducts, "/admin/products", { token: owner.token })).json();
    expect(all.data.map((p: { id: string }) => p.id)).toEqual([second.id, first.id]);
    expect(all.data[0]).toMatchObject({
      slug: "hydrating-cream",
      status: "DRAFT",
      defaultVariant: { sku: "CREAM-50ML" },
      activeVariantCount: 2,
    });
    expect(all.meta.pagination).toMatchObject({ total: 2, page: 1 });

    for (const search of ["cream-100", "HYDRATING", "كريم", "hydrating-cr"]) {
      const res = await call(listProducts, `/admin/products?search=${encodeURIComponent(search)}`, {
        token: owner.token,
      });
      const ids = (await res.json()).data.map((p: { id: string }) => p.id);
      expect(ids, search).toEqual([second.id]);
    }

    const published = await call(listProducts, "/admin/products?status=PUBLISHED", {
      token: owner.token,
    });
    expect((await published.json()).data).toEqual([]);
    const bad = await call(listProducts, "/admin/products?status=GONE", { token: owner.token });
    expect(bad.status).toBe(400);
  });
});

describe("GET/PATCH /admin/products/{id}", () => {
  it("answers 404 for unknown and malformed ids", async () => {
    const owner = await staff("OWNER");
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      const res = await call(productDetail, `/admin/products/${id}`, {
        token: owner.token,
        params: { id },
      });
      expect(res.status).toBe(404);
    }
  });

  it("edits content, audits before and after, and skips no-op edits", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await createOk(editor.token);
    const edit = (body: unknown) =>
      call(patchProduct, `/admin/products/${product.id}`, {
        method: "PATCH",
        token: editor.token,
        body,
        params: { id: product.id },
      });

    const res = await edit({
      nameEn: "Velvet Matte Lipstick",
      slug: "velvet-matte",
      descriptionEn: "",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      nameEn: "Velvet Matte Lipstick",
      slug: "velvet-matte",
      descriptionEn: null,
      status: "DRAFT",
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PRODUCT_UPDATED" } });
    expect(audit.previousDataJson).toMatchObject({
      nameEn: "Matte Lipstick",
      slug: "matte-lipstick",
    });
    expect(audit.newDataJson).toMatchObject({
      nameEn: "Velvet Matte Lipstick",
      slug: "velvet-matte",
    });

    expect((await edit({ nameEn: "Velvet Matte Lipstick" })).status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "PRODUCT_UPDATED" } })).toBe(1);

    expect((await edit({})).status).toBe(400);
  });

  it("refuses a taken slug, and slug changes once the product left draft", async () => {
    const owner = await staff("OWNER");
    const product = await createOk(owner.token);
    await createOk(owner.token, { nameAr: "ب", nameEn: "Blush", defaultVariant: { sku: "BL-1" } });
    const edit = (body: unknown) =>
      call(patchProduct, `/admin/products/${product.id}`, {
        method: "PATCH",
        token: owner.token,
        body,
        params: { id: product.id },
      });

    const taken = await edit({ slug: "blush" });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.details.reason).toBe("SLUG_TAKEN");

    // Set the state directly; the lifecycle endpoints are tested in lifecycle-routes.
    await db.product.update({
      where: { id: product.id },
      data: { status: "PUBLISHED", firstPublishedAt: new Date() },
    });
    const locked = await edit({ slug: "new-slug" });
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.details.reason).toBe("SLUG_LOCKED");
    expect((await edit({ nameEn: "Renamed" })).status).toBe(200);

    await db.product.update({
      where: { id: product.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    const archived = await edit({ nameEn: "Again" });
    expect(archived.status).toBe(409);
    expect((await archived.json()).error.details.reason).toBe("PRODUCT_ARCHIVED");
  });
});

describe("variants", () => {
  async function setup() {
    const owner = await staff("OWNER");
    const product = await createOk(owner.token);
    const defaultVariant = product.variants[0];
    const add = (body: unknown, productId = product.id) =>
      call(addVariant, `/admin/products/${productId}/variants`, {
        method: "POST",
        token: owner.token,
        body,
        params: { id: productId },
      });
    const patch = (id: string, body: unknown) =>
      call(patchVariant, `/admin/variants/${id}`, {
        method: "PATCH",
        token: owner.token,
        body,
        params: { id },
      });
    const archive = (id: string) =>
      call(archiveVariant, `/admin/variants/${id}/archive`, {
        method: "POST",
        token: owner.token,
        params: { id },
      });
    return { owner, product, defaultVariant, add, patch, archive };
  }

  it("adds non-default variants and lists them in creation order", async () => {
    const { owner, product, defaultVariant, add } = await setup();
    const res = await add({ sku: "lip-matte-02", nameAr: "أحمر", nameEn: "Red" });
    expect(res.status).toBe(201);
    const variant = (await res.json()).data;
    expect(variant).toMatchObject({ sku: "LIP-MATTE-02", isDefault: false, status: "ACTIVE" });

    const list = await call(listVariants, `/admin/products/${product.id}/variants`, {
      token: owner.token,
      params: { id: product.id },
    });
    expect((await list.json()).data.map((v: { id: string }) => v.id)).toEqual([
      defaultVariant.id,
      variant.id,
    ]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_VARIANT_CREATED" },
    });
    expect(audit).toMatchObject({ entityType: "PRODUCT_VARIANT", entityId: variant.id });

    expect((await add({ sku: "LIP-MATTE-02" })).status).toBe(409);
    expect((await add({ sku: "X" }, UNKNOWN_ID)).status).toBe(404);
    const missingPair = await add({ sku: "LIP-3", nameAr: "أ" });
    expect(missingPair.status).toBe(400);
  });

  it("edits a variant, keeps names paired and SKUs unique", async () => {
    const { defaultVariant, add, patch } = await setup();
    const other = (await (await add({ sku: "LIP-2" })).json()).data;

    const res = await patch(defaultVariant.id, {
      sku: "lip-matte-rose",
      attributes: { shade: "Rose", finish: "Matte" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      sku: "LIP-MATTE-ROSE",
      attributes: { shade: "Rose", finish: "Matte" },
    });

    const half = await patch(defaultVariant.id, { nameEn: null });
    expect(half.status).toBe(400);
    expect((await half.json()).error.details.issues[0].code).toBe("variant_name_pair");
    expect((await patch(defaultVariant.id, { nameEn: null, nameAr: null })).status).toBe(200);

    const clash = await patch(other.id, { sku: "lip-matte-rose" });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error.details.reason).toBe("SKU_TAKEN");

    expect((await patch(UNKNOWN_ID, { sku: "Z" })).status).toBe(404);
  });

  it("moves the default to another variant, keeping exactly one", async () => {
    const { product, defaultVariant, add, patch } = await setup();
    const other = (await (await add({ sku: "LIP-2", nameAr: "أ", nameEn: "A" })).json()).data;

    const res = await patch(other.id, { isDefault: true });
    expect(res.status).toBe(200);
    expect((await res.json()).data.isDefault).toBe(true);
    const defaults = await db.productVariant.findMany({
      where: { productId: product.id, isDefault: true },
    });
    expect(defaults.map((v) => v.id)).toEqual([other.id]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_VARIANT_UPDATED", entityId: other.id },
    });
    expect(audit.previousDataJson).toMatchObject({
      isDefault: false,
      previousDefaultVariantId: defaultVariant.id,
    });
  });

  it("archives a non-default variant once; the default and archived variants are protected", async () => {
    const { defaultVariant, add, patch, archive } = await setup();
    const other = (await (await add({ sku: "LIP-2" })).json()).data;

    const refused = await archive(defaultVariant.id);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.details.reason).toBe("VARIANT_IS_DEFAULT");

    const res = await archive(other.id);
    expect(res.status).toBe(200);
    const archived = (await res.json()).data;
    expect(archived).toMatchObject({ status: "ARCHIVED", isDefault: false });
    expect(archived.archivedAt).not.toBeNull();

    // Repeating is harmless and writes no second entry.
    expect((await archive(other.id)).status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "PRODUCT_VARIANT_ARCHIVED" } })).toBe(1);

    for (const body of [{ sku: "LIP-3" }, { isDefault: true }]) {
      const blocked = await patch(other.id, body);
      expect(blocked.status).toBe(409);
      expect((await blocked.json()).error.details.reason).toBe("VARIANT_ARCHIVED");
    }
    // The SKU of an archived variant is never reused.
    expect((await add({ sku: "LIP-2" })).status).toBe(409);
    expect((await archive(UNKNOWN_ID)).status).toBe(404);
  });

  it("refuses variant changes on an archived product", async () => {
    const { product, defaultVariant, add, patch } = await setup();
    await db.product.update({
      where: { id: product.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    for (const res of [await add({ sku: "LIP-9" }), await patch(defaultVariant.id, { sku: "Y" })]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error.details.reason).toBe("PRODUCT_ARCHIVED");
    }
  });
});
