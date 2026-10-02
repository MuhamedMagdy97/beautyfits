import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as archiveProduct } from "@/app/api/v1/admin/products/[id]/archive/route";
import { POST as addMedia } from "@/app/api/v1/admin/products/[id]/media/route";
import { POST as priceReview } from "@/app/api/v1/admin/products/[id]/price-review/route";
import { POST as publishProduct } from "@/app/api/v1/admin/products/[id]/publish/route";
import { GET as getProduct } from "@/app/api/v1/admin/products/[id]/route";
import {
  GET as listVariants,
  POST as createVariant,
} from "@/app/api/v1/admin/products/[id]/variants/route";
import { POST as createProduct } from "@/app/api/v1/admin/products/route";
import { PATCH as patchCost } from "@/app/api/v1/admin/variants/[id]/cost/route";
import { POST as completeUpload } from "@/app/api/v1/files/complete/route";
import { POST as uploadInit } from "@/app/api/v1/files/upload-init/route";
import { PUT as uploadBytes } from "@/app/api/v1/files/uploads/[id]/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { SETTING_KEYS } from "@/server/modules/settings/settings";
import { MS_PER_HOUR } from "@/server/time/time";
import { png } from "@/test/fixtures/images";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of selling prices and costs (API §13, "TASK-018
 * Amendments", ADR-0023): price review, opening costs, cost visibility and
 * the selling-price publish requirement.
 */

const db = getDb();
const BASE = "http://localhost/api/v1";
const SAME_ORIGIN = "http://localhost";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    token?: string;
    headers?: Record<string, string>;
    body?: unknown;
    rawBody?: Buffer;
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
  const body =
    options.rawBody !== undefined
      ? new Uint8Array(options.rawBody)
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);
  return (handler as Handler)(
    new Request(`${BASE}${path}`, { method: options.method ?? "GET", headers, body }),
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
      email: `pricing${counter}@beautyfits.example`,
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

/** The Catalog Editor default role (permission catalog §3): no prices, no costs. */
const CATALOG_EDITOR: PermissionCode[] = [
  "PRODUCT_VIEW",
  "PRODUCT_CREATE",
  "PRODUCT_EDIT",
  "MANAGE_PRODUCT_MEDIA",
  "TAXONOMY_MANAGE",
];

/** The cost part of the Inventory Manager default role (Q74). */
const COST_KEEPER: PermissionCode[] = ["PRODUCT_VIEW", "VIEW_COST_PRICE", "EDIT_COST_PRICE"];

/** Can set prices but not see costs. */
const PRICER: PermissionCode[] = ["PRODUCT_VIEW", "EDIT_PRODUCT_PRICE"];

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

async function newProduct(token: string, sellingPrice?: number) {
  counter += 1;
  return data(
    await call(createProduct, "/admin/products", {
      method: "POST",
      token,
      body: {
        nameAr: "أحمر شفاه",
        nameEn: `Matte Lipstick ${counter}`,
        defaultVariant: {
          sku: `SKU-${counter}`,
          ...(sellingPrice !== undefined ? { sellingPrice } : {}),
        },
      },
    }),
    201,
  );
}

/** Uploads an image through the three upload steps and attaches it. */
async function addImage(token: string, productId: string) {
  const bytes = png(600, 600);
  const started = await data(
    await call(uploadInit, "/files/upload-init", {
      method: "POST",
      token,
      body: {
        purpose: "PRODUCT_MEDIA",
        filename: "a.png",
        mimeType: "image/png",
        sizeBytes: bytes.length,
      },
    }),
    201,
  );
  const sent = await call(uploadBytes, `/files/uploads/${started.mediaAssetId}`, {
    method: "PUT",
    headers: started.upload.headers,
    rawBody: bytes,
    params: { id: started.mediaAssetId },
  });
  expect(sent.status).toBe(204);
  await data(
    await call(completeUpload, "/files/complete", {
      method: "POST",
      token,
      body: { mediaAssetId: started.mediaAssetId },
    }),
  );
  return data(
    await call(addMedia, `/admin/products/${productId}/media`, {
      method: "POST",
      token,
      body: { mediaAssetId: started.mediaAssetId },
      params: { id: productId },
    }),
    201,
  );
}

function review(token: string, productId: string, body: unknown, headers?: Record<string, string>) {
  return call(priceReview, `/admin/products/${productId}/price-review`, {
    method: "POST",
    token,
    body,
    headers,
    params: { id: productId },
  });
}

function setCosts(token: string, variantId: string, body: unknown) {
  return call(patchCost, `/admin/variants/${variantId}/cost`, {
    method: "PATCH",
    token,
    body,
    params: { id: variantId },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await rm(getEnv().MEDIA_DIR, { recursive: true, force: true });
  await db.$disconnect();
});

describe("authorization", () => {
  it("guards price review and cost edits with their own permissions", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const variantId = product.variants[0].id;
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const costKeeper = await staff("MANAGER", COST_KEEPER);
    const pricer = await staff("MANAGER", PRICER);
    const body = { items: [{ variantId, sellingPrice: 10_000 }] };

    const anonymous = await call(priceReview, `/admin/products/${product.id}/price-review`, {
      method: "POST",
      body,
      params: { id: product.id },
    });
    expect(anonymous.status).toBe(401);
    // Q73: editing the catalog does not include prices; costs do not either.
    for (const token of [editor.token, costKeeper.token]) {
      const denied = await errorOf(await review(token, product.id, body), 403);
      expect(denied.details.requiredPermissions).toEqual(["EDIT_PRODUCT_PRICE"]);
    }
    for (const token of [editor.token, pricer.token]) {
      const denied = await errorOf(
        await setCosts(token, variantId, { latestPurchaseCost: 1, reason: "Opening stock" }),
        403,
      );
      expect(denied.details.requiredPermissions).toEqual(["EDIT_COST_PRICE"]);
    }
  });

  it("needs EDIT_PRODUCT_PRICE to give a price when creating", async () => {
    const owner = await staff("OWNER");
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await newProduct(owner.token);
    const denied = await errorOf(
      await call(createProduct, "/admin/products", {
        method: "POST",
        token: editor.token,
        body: {
          nameAr: "ماسكرا",
          nameEn: "Mascara",
          defaultVariant: { sku: "MAS-1", sellingPrice: 1 },
        },
      }),
      403,
    );
    expect(denied.details.requiredPermissions).toEqual(["EDIT_PRODUCT_PRICE"]);
    await errorOf(
      await call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: editor.token,
        body: { sku: "LIP-2", sellingPrice: 1 },
        params: { id: product.id },
      }),
      403,
    );
    // Without a price the editor may still create both.
    await data(
      await call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: editor.token,
        body: { sku: "LIP-2" },
        params: { id: product.id },
      }),
      201,
    );
    expect(await db.productVariant.count({ where: { sellingPrice: { not: null } } })).toBe(0);
  });

  it("requires the Origin check for cookie-authenticated price changes", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    const body = {
      items: [{ variantId: product.variants[0].id, sellingPrice: 10_000 }],
      apply: true,
    };
    const send = (headers: Record<string, string>) =>
      call(priceReview, `/admin/products/${product.id}/price-review`, {
        method: "POST",
        headers,
        body,
        params: { id: product.id },
      });
    expect((await errorOf(await send({ cookie }), 403)).code).toBe("FORBIDDEN");
    expect((await data(await send({ cookie, origin: SAME_ORIGIN }))).applied).toBe(true);
  });
});

describe("cost visibility (Q74, Q80)", () => {
  it("shows costs and margins only to callers with VIEW_COST_PRICE", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token, 10_000);
    const variantId = product.variants[0].id;
    await data(
      await setCosts(owner.token, variantId, {
        latestPurchaseCost: 6000,
        weightedAverageCost: 5800,
        reason: "Opening stock count",
      }),
    );
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const costKeeper = await staff("MANAGER", COST_KEEPER);

    const read = async (token: string) => [
      (
        await data(
          await call(getProduct, `/admin/products/${product.id}`, {
            token,
            params: { id: product.id },
          }),
        )
      ).variants[0],
      (
        await data(
          await call(listVariants, `/admin/products/${product.id}/variants`, {
            token,
            params: { id: product.id },
          }),
        )
      )[0],
    ];

    for (const variant of await read(editor.token)) {
      expect(variant).toMatchObject({ sellingPrice: 10_000, currency: "EGP" });
      expect(variant).not.toHaveProperty("costs");
    }
    for (const variant of await read(costKeeper.token)) {
      expect(variant.costs).toEqual({
        latestPurchaseCost: 6000,
        weightedAverageCost: 5800,
        marginBasisPoints: 4000,
        costsEditable: true,
      });
    }
    // The cost edit itself answers with costs only to callers who may see them.
    const blindCostEditor = await staff("MANAGER", ["PRODUCT_VIEW", "EDIT_COST_PRICE"]);
    const answer = await data(
      await setCosts(blindCostEditor.token, variantId, {
        latestPurchaseCost: 6100,
        reason: "Corrected opening cost",
      }),
    );
    expect(answer).not.toHaveProperty("costs");
  });
});

describe("price review (Q111)", () => {
  it("previews without saving, then applies and audits the change", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const variantId = product.variants[0].id;
    await data(
      await setCosts(owner.token, variantId, { latestPurchaseCost: 6000, reason: "Opening" }),
    );

    const preview = await data(
      await review(owner.token, product.id, { items: [{ variantId, sellingPrice: 10_000 }] }),
    );
    expect(preview).toEqual({
      applied: false,
      minimumMarginBasisPoints: 1000,
      items: [
        {
          variantId,
          sku: product.variants[0].sku,
          currentPrice: null,
          proposedPrice: 10_000,
          changes: true,
          latestPurchaseCost: 6000,
          marginBasisPoints: 4000,
          warnings: [],
        },
      ],
    });
    expect(
      (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).sellingPrice,
    ).toBeNull();
    expect(await db.auditLog.count({ where: { action: "PRODUCT_VARIANT_PRICE_CHANGED" } })).toBe(0);

    const applied = await data(
      await review(
        owner.token,
        product.id,
        { items: [{ variantId, sellingPrice: 10_000 }], apply: true, reason: "Launch price" },
        { "x-request-id": "req-price-1" },
      ),
    );
    expect(applied.applied).toBe(true);
    expect(
      (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).sellingPrice,
    ).toBe(BigInt(10_000));
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_VARIANT_PRICE_CHANGED" },
    });
    expect(audit).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: owner.employee.id,
      entityType: "PRODUCT_VARIANT",
      entityId: variantId,
      previousDataJson: { sellingPrice: null },
      newDataJson: { sellingPrice: 10_000 },
      reason: "Launch price",
      correlationId: "req-price-1",
    });

    // The same price again changes nothing and writes no entry.
    const repeat = await data(
      await review(owner.token, product.id, {
        items: [{ variantId, sellingPrice: 10_000 }],
        apply: true,
      }),
    );
    expect(repeat.items[0].changes).toBe(false);
    expect(await db.auditLog.count({ where: { action: "PRODUCT_VARIANT_PRICE_CHANGED" } })).toBe(1);
  });

  it("suggests a price from a target margin over the latest purchase cost", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const variantId = product.variants[0].id;

    const unknown = await errorOf(
      await review(owner.token, product.id, {
        items: [{ variantId, targetMarginBasisPoints: 4000 }],
      }),
      409,
    );
    expect(unknown.details).toEqual({ reason: "COST_UNKNOWN", variantId });

    await data(
      await setCosts(owner.token, variantId, { latestPurchaseCost: 1000, reason: "Opening" }),
    );
    const applied = await data(
      await review(owner.token, product.id, {
        items: [{ variantId, targetMarginBasisPoints: 3000 }],
        apply: true,
      }),
    );
    // 10.00 / 0.7 = 14.2857… → 14.29 EGP
    expect(applied.items[0]).toMatchObject({ proposedPrice: 1429, marginBasisPoints: 3002 });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_VARIANT_PRICE_CHANGED" },
    });
    expect(audit.newDataJson).toEqual({ sellingPrice: 1429, targetMarginBasisPoints: 3000 });
  });

  it("warns below the minimum margin and at or below cost, without blocking", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const variantId = product.variants[0].id;
    await data(
      await setCosts(owner.token, variantId, { latestPurchaseCost: 9500, reason: "Opening" }),
    );

    const thin = await data(
      await review(owner.token, product.id, {
        items: [{ variantId, sellingPrice: 10_000 }],
        apply: true,
      }),
    );
    expect(thin.items[0]).toMatchObject({
      marginBasisPoints: 500,
      warnings: ["BELOW_MINIMUM_MARGIN"],
    });
    expect(thin.applied).toBe(true);

    // The threshold is the Owner's setting (ADR-0023 §4 item 2).
    await db.setting.create({
      data: { key: SETTING_KEYS.pricingMinMarginBasisPoints, valueJson: 0, dataType: "INTEGER" },
    });
    const loss = await data(
      await review(owner.token, product.id, { items: [{ variantId, sellingPrice: 9500 }] }),
    );
    expect(loss).toMatchObject({ minimumMarginBasisPoints: 0 });
    expect(loss.items[0].warnings).toEqual(["PRICE_NOT_ABOVE_COST"]);
  });

  it("hides margins from callers who cannot see costs, and refuses them target margins", async () => {
    const owner = await staff("OWNER");
    const pricer = await staff("MANAGER", PRICER);
    const product = await newProduct(owner.token);
    const variantId = product.variants[0].id;
    await data(
      await setCosts(owner.token, variantId, { latestPurchaseCost: 6000, reason: "Opening" }),
    );

    const result = await data(
      await review(pricer.token, product.id, { items: [{ variantId, sellingPrice: 10_000 }] }),
    );
    expect(result).not.toHaveProperty("minimumMarginBasisPoints");
    expect(result.items[0]).toEqual({
      variantId,
      sku: product.variants[0].sku,
      currentPrice: null,
      proposedPrice: 10_000,
      changes: true,
    });
    const denied = await errorOf(
      await review(pricer.token, product.id, {
        items: [{ variantId, targetMarginBasisPoints: 4000 }],
      }),
      403,
    );
    expect(denied.details.requiredPermissions).toEqual(["VIEW_COST_PRICE"]);
  });

  it("validates the items", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const other = await newProduct(owner.token);
    const variantId = product.variants[0].id;
    const invalid = [
      { items: [] },
      { items: [{ variantId }] },
      { items: [{ variantId, sellingPrice: 100, targetMarginBasisPoints: 1000 }] },
      { items: [{ variantId, sellingPrice: 0 }] },
      { items: [{ variantId, sellingPrice: 12.5 }] },
      { items: [{ variantId, targetMarginBasisPoints: 10_000 }] },
      {
        items: [
          { variantId, sellingPrice: 100 },
          { variantId, sellingPrice: 200 },
        ],
      },
    ];
    for (const body of invalid) {
      await errorOf(await review(owner.token, product.id, body), 400);
    }
    const foreign = await errorOf(
      await review(owner.token, product.id, {
        items: [{ variantId: other.variants[0].id, sellingPrice: 100 }],
      }),
      400,
    );
    expect(foreign.details.issues[0]).toMatchObject({
      path: "items.0.variantId",
      code: "variant_not_found",
    });
  });

  it("refuses archived products", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    await data(
      await call(archiveProduct, `/admin/products/${product.id}/archive`, {
        method: "POST",
        token: owner.token,
        params: { id: product.id },
      }),
    );
    const refused = await errorOf(
      await review(owner.token, product.id, {
        items: [{ variantId: product.variants[0].id, sellingPrice: 100 }],
      }),
      409,
    );
    expect(refused.details.reason).toBe("PRODUCT_ARCHIVED");
  });
});

describe("opening costs (ADR-0023 §4 item 4)", () => {
  it("sets costs with a reason and audits them", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const variantId = product.variants[0].id;

    await errorOf(await setCosts(owner.token, variantId, { latestPurchaseCost: 100 }), 400);
    await errorOf(await setCosts(owner.token, variantId, { reason: "Nothing" }), 400);
    await errorOf(
      await setCosts(owner.token, variantId, { latestPurchaseCost: -1, reason: "Bad" }),
      400,
    );

    const updated = await data(
      await setCosts(owner.token, variantId, {
        latestPurchaseCost: 6000,
        weightedAverageCost: 5800,
        reason: "Opening stock count",
      }),
    );
    expect(updated.costs).toMatchObject({ latestPurchaseCost: 6000, weightedAverageCost: 5800 });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_VARIANT_COST_CHANGED" },
    });
    expect(audit).toMatchObject({
      entityId: variantId,
      previousDataJson: { latestPurchaseCost: null, weightedAverageCost: null },
      newDataJson: { latestPurchaseCost: 6000, weightedAverageCost: 5800 },
      reason: "Opening stock count",
    });

    // Repeating the same values writes no entry.
    await data(
      await setCosts(owner.token, variantId, { latestPurchaseCost: 6000, reason: "Again" }),
    );
    expect(await db.auditLog.count({ where: { action: "PRODUCT_VARIANT_COST_CHANGED" } })).toBe(1);
  });

  it("refuses manual costs once a goods receipt has set them", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const variantId = product.variants[0].id;
    // Set by the goods receipt task (TASK-023).
    await db.productVariant.update({
      where: { id: variantId },
      data: { firstGoodsReceiptAt: new Date() },
    });
    const refused = await errorOf(
      await setCosts(owner.token, variantId, { latestPurchaseCost: 100, reason: "Fix" }),
      409,
    );
    expect(refused.details.reason).toBe("COSTS_LOCKED");
    const view = await data(
      await call(getProduct, `/admin/products/${product.id}`, {
        token: owner.token,
        params: { id: product.id },
      }),
    );
    expect(view.variants[0].costs.costsEditable).toBe(false);
  });
});

describe("publishing needs prices (ADR-0023 §4 item 5)", () => {
  it("refuses to publish an unpriced variant, and a new unpriced variant once published", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    await addImage(owner.token, product.id);
    const refused = await errorOf(
      await call(publishProduct, `/admin/products/${product.id}/publish`, {
        method: "POST",
        token: owner.token,
        params: { id: product.id },
      }),
      409,
    );
    expect(refused.details).toMatchObject({
      missing: ["SELLING_PRICE"],
      unpricedVariantIds: [product.variants[0].id],
    });

    await data(
      await review(owner.token, product.id, {
        items: [{ variantId: product.variants[0].id, sellingPrice: 10_000 }],
        apply: true,
      }),
    );
    await data(
      await call(publishProduct, `/admin/products/${product.id}/publish`, {
        method: "POST",
        token: owner.token,
        params: { id: product.id },
      }),
    );
    // Name the default so the only missing thing on a new variant is its price.
    await db.productVariant.update({
      where: { id: product.variants[0].id },
      data: { variantNameAr: "أحمر", variantNameEn: "Red" },
    });
    const add = (body: Record<string, unknown>) =>
      call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: owner.token,
        body: { sku: "LIP-ROSE", nameAr: "وردي", nameEn: "Rose", ...body },
        params: { id: product.id },
      });
    expect((await errorOf(await add({}), 409)).details.reason).toBe("SELLING_PRICE_REQUIRED");
    expect((await data(await add({ sellingPrice: 12_000 }), 201)).sellingPrice).toBe(12_000);
  });
});

describe("database guards", () => {
  it("keeps prices positive, costs non-negative and a set price from being cleared", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token, 10_000);
    const where = { id: product.variants[0].id };
    await expect(
      db.productVariant.update({ where, data: { sellingPrice: BigInt(0) } }),
    ).rejects.toThrow();
    await expect(
      db.productVariant.update({ where, data: { latestPurchaseCost: BigInt(-1) } }),
    ).rejects.toThrow();
    await expect(db.productVariant.update({ where, data: { currency: "USD" } })).rejects.toThrow();
    await expect(db.productVariant.update({ where, data: { sellingPrice: null } })).rejects.toThrow(
      /cannot be cleared/,
    );
  });
});
