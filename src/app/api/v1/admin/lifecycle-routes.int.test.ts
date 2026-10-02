import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as archiveProduct } from "@/app/api/v1/admin/products/[id]/archive/route";
import { POST as disableProduct } from "@/app/api/v1/admin/products/[id]/disable/route";
import { DELETE as removeMedia } from "@/app/api/v1/admin/products/[id]/media/[mediaId]/route";
import { POST as addMedia } from "@/app/api/v1/admin/products/[id]/media/route";
import { POST as publishProduct } from "@/app/api/v1/admin/products/[id]/publish/route";
import { PATCH as patchProduct } from "@/app/api/v1/admin/products/[id]/route";
import { POST as unpublishProduct } from "@/app/api/v1/admin/products/[id]/unpublish/route";
import { POST as createVariant } from "@/app/api/v1/admin/products/[id]/variants/route";
import { POST as createProduct } from "@/app/api/v1/admin/products/route";
import { PATCH as patchVariant } from "@/app/api/v1/admin/variants/[id]/route";
import { GET as fileContent } from "@/app/api/v1/files/[id]/content/route";
import { POST as completeUpload } from "@/app/api/v1/files/complete/route";
import { POST as uploadInit } from "@/app/api/v1/files/upload-init/route";
import { PUT as uploadBytes } from "@/app/api/v1/files/uploads/[id]/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { MS_PER_HOUR } from "@/server/time/time";
import { png } from "@/test/fixtures/images";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of the product lifecycle (API §13, "TASK-017
 * Amendments", ADR-0022): publish, unpublish, disable, archive.
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
      email: `lifecycle${counter}@beautyfits.example`,
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

/** The Catalog Editor default role (permission catalog §3): no publish or archive. */
const CATALOG_EDITOR: PermissionCode[] = [
  "PRODUCT_VIEW",
  "PRODUCT_CREATE",
  "PRODUCT_EDIT",
  "MANAGE_PRODUCT_MEDIA",
  "TAXONOMY_MANAGE",
];

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

const ENDPOINTS = {
  publish: publishProduct,
  unpublish: unpublishProduct,
  disable: disableProduct,
  archive: archiveProduct,
} as const;
type Transition = keyof typeof ENDPOINTS;

function transition(
  name: Transition,
  token: string,
  productId: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return call(ENDPOINTS[name], `/admin/products/${productId}/${name}`, {
    method: "POST",
    token,
    params: { id: productId },
    ...options,
  });
}

async function newProduct(token: string) {
  counter += 1;
  return data(
    await call(createProduct, "/admin/products", {
      method: "POST",
      token,
      body: {
        nameAr: "أحمر شفاه",
        nameEn: `Matte Lipstick ${counter}`,
        defaultVariant: { sku: `SKU-${counter}` },
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

/** A draft product with a main image, ready to publish. */
async function readyProduct(token: string) {
  const product = await newProduct(token);
  const image = await addImage(token, product.id);
  return { product, image };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await rm(getEnv().MEDIA_DIR, { recursive: true, force: true });
  await db.$disconnect();
});

describe("authorization", () => {
  it("requires a session and the matching permission for each transition", async () => {
    const owner = await staff("OWNER");
    const { product } = await readyProduct(owner.token);
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const publisher = await staff("MANAGER", ["PRODUCT_VIEW", "PRODUCT_PUBLISH"]);
    const archiver = await staff("MANAGER", ["PRODUCT_VIEW", "PRODUCT_ARCHIVE"]);

    for (const name of Object.keys(ENDPOINTS) as Transition[]) {
      const anonymous = await call(ENDPOINTS[name], `/admin/products/${product.id}/${name}`, {
        method: "POST",
        params: { id: product.id },
      });
      expect(anonymous.status).toBe(401);
      // The Catalog Editor role can neither publish nor archive (R18).
      expect((await errorOf(await transition(name, editor.token, product.id), 403)).code).toBe(
        "PERMISSION_DENIED",
      );
    }
    for (const name of ["disable", "archive"] as const) {
      await errorOf(await transition(name, publisher.token, product.id), 403);
    }
    for (const name of ["publish", "unpublish"] as const) {
      await errorOf(await transition(name, archiver.token, product.id), 403);
    }

    await data(await transition("publish", publisher.token, product.id));
    await data(await transition("disable", archiver.token, product.id));
    await data(await transition("unpublish", publisher.token, product.id));
    await data(await transition("archive", archiver.token, product.id));
  });

  it("requires the Origin check for cookie-authenticated transitions", async () => {
    const owner = await staff("OWNER");
    const { product } = await readyProduct(owner.token);
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    const blocked = await call(publishProduct, `/admin/products/${product.id}/publish`, {
      method: "POST",
      headers: { cookie },
      params: { id: product.id },
    });
    expect((await errorOf(blocked, 403)).code).toBe("FORBIDDEN");
    const allowed = await call(publishProduct, `/admin/products/${product.id}/publish`, {
      method: "POST",
      headers: { cookie, origin: SAME_ORIGIN },
      params: { id: product.id },
    });
    expect((await data(allowed)).status).toBe("PUBLISHED");
  });

  it("answers 404 for unknown or malformed product ids", async () => {
    const owner = await staff("OWNER");
    await errorOf(await transition("publish", owner.token, UNKNOWN_ID), 404);
    await errorOf(await transition("archive", owner.token, "not-a-uuid"), 404);
  });
});

describe("transitions", () => {
  it("publishes, disables, unpublishes and archives, auditing each with its reason", async () => {
    const owner = await staff("OWNER");
    const { product } = await readyProduct(owner.token);

    const published = await data(
      await transition("publish", owner.token, product.id, {
        headers: { "x-request-id": "req-publish-1" },
      }),
    );
    expect(published).toMatchObject({ id: product.id, status: "PUBLISHED", archivedAt: null });
    expect(published.firstPublishedAt).toEqual(expect.any(String));
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PRODUCT_PUBLISHED" } });
    expect(audit).toMatchObject({
      actorType: "EMPLOYEE",
      actorId: owner.employee.id,
      entityType: "PRODUCT",
      entityId: product.id,
      previousDataJson: { status: "DRAFT" },
      newDataJson: { status: "PUBLISHED" },
      reason: null,
      correlationId: "req-publish-1",
    });

    const disabled = await data(
      await transition("disable", owner.token, product.id, {
        body: { reason: "  Supplier recall  " },
      }),
    );
    expect(disabled.status).toBe("DISABLED");
    expect(
      await db.auditLog.findFirstOrThrow({ where: { action: "PRODUCT_DISABLED" } }),
    ).toMatchObject({ previousDataJson: { status: "PUBLISHED" }, reason: "Supplier recall" });

    // Disabled products stay editable (ADR-0022 §4 item 1).
    await data(
      await call(patchProduct, `/admin/products/${product.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { nameEn: "Renamed while paused" },
        params: { id: product.id },
      }),
    );

    const draft = await data(await transition("unpublish", owner.token, product.id));
    expect(draft).toMatchObject({ status: "DRAFT", firstPublishedAt: published.firstPublishedAt });

    const archived = await data(
      await transition("archive", owner.token, product.id, { body: { reason: "" } }),
    );
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).toEqual(expect.any(String));
    expect(
      await db.auditLog.findFirstOrThrow({ where: { action: "PRODUCT_ARCHIVED" } }),
    ).toMatchObject({ previousDataJson: { status: "DRAFT" }, reason: null });
    expect(await db.auditLog.count({ where: { action: "PRODUCT_UNPUBLISHED" } })).toBe(1);
  });

  it("returns the same product for a repeated transition and writes no audit entry", async () => {
    const owner = await staff("OWNER");
    const { product } = await readyProduct(owner.token);
    const first = await data(await transition("publish", owner.token, product.id));
    const again = await data(await transition("publish", owner.token, product.id));
    expect(again).toEqual(first);
    expect(await db.auditLog.count({ where: { action: "PRODUCT_PUBLISHED" } })).toBe(1);

    await data(await transition("archive", owner.token, product.id));
    await data(await transition("archive", owner.token, product.id));
    expect(await db.auditLog.count({ where: { action: "PRODUCT_ARCHIVED" } })).toBe(1);

    const draft = await newProduct(owner.token);
    expect((await data(await transition("unpublish", owner.token, draft.id))).status).toBe("DRAFT");
    expect(await db.auditLog.count({ where: { action: "PRODUCT_UNPUBLISHED" } })).toBe(0);
  });

  it("refuses transitions the current status does not allow", async () => {
    const owner = await staff("OWNER");
    const { product } = await readyProduct(owner.token);
    const notLive = await errorOf(await transition("disable", owner.token, product.id), 409);
    expect(notLive.details).toMatchObject({ reason: "PRODUCT_STATUS_INVALID", status: "DRAFT" });

    await data(await transition("archive", owner.token, product.id));
    for (const name of ["publish", "unpublish", "disable"] as const) {
      const final = await errorOf(await transition(name, owner.token, product.id), 409);
      expect(final.details.reason).toBe("PRODUCT_ARCHIVED");
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
      "ARCHIVED",
    );
  });

  it("validates the optional reason", async () => {
    const owner = await staff("OWNER");
    const { product } = await readyProduct(owner.token);
    const tooLong = await errorOf(
      await transition("publish", owner.token, product.id, { body: { reason: "x".repeat(1001) } }),
      400,
    );
    expect(tooLong.code).toBe("VALIDATION_ERROR");
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
      "DRAFT",
    );
  });
});

describe("publish requirements", () => {
  it("needs a main image, and names on every variant when there are several", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    await data(
      await call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: owner.token,
        body: { sku: "LIP-ROSE", nameAr: "وردي", nameEn: "Rose" },
        params: { id: product.id },
      }),
      201,
    );

    const refused = await errorOf(await transition("publish", owner.token, product.id), 409);
    expect(refused.details).toEqual({
      reason: "PUBLISH_REQUIREMENTS_NOT_MET",
      missing: ["MAIN_IMAGE", "VARIANT_NAMES"],
      unnamedVariantIds: [product.variants[0].id],
    });
    expect(await db.auditLog.count({ where: { action: "PRODUCT_PUBLISHED" } })).toBe(0);

    await addImage(owner.token, product.id);
    await data(
      await call(patchVariant, `/admin/variants/${product.variants[0].id}`, {
        method: "PATCH",
        token: owner.token,
        body: { nameAr: "أحمر", nameEn: "Red" },
        params: { id: product.variants[0].id },
      }),
    );
    expect((await data(await transition("publish", owner.token, product.id))).status).toBe(
      "PUBLISHED",
    );
  });

  it("re-checks when a disabled product is published again", async () => {
    const owner = await staff("OWNER");
    const { product, image } = await readyProduct(owner.token);
    await data(await transition("publish", owner.token, product.id));
    await data(await transition("disable", owner.token, product.id));
    // While disabled the last image may go; publishing again then needs one.
    await data(
      await call(removeMedia, `/admin/products/${product.id}/media/${image.id}`, {
        method: "DELETE",
        token: owner.token,
        params: { id: product.id, mediaId: image.id },
      }),
    );
    const refused = await errorOf(await transition("publish", owner.token, product.id), 409);
    expect(refused.details.missing).toEqual(["MAIN_IMAGE"]);
  });
});

describe("a published product stays publishable", () => {
  async function publishedProduct(token: string) {
    const { product } = await readyProduct(token);
    await data(await transition("publish", token, product.id));
    return product;
  }

  it("refuses a second variant while the default is unnamed, and an unnamed new variant", async () => {
    const owner = await staff("OWNER");
    const product = await publishedProduct(owner.token);
    const add = (body: Record<string, unknown>) =>
      call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: owner.token,
        body,
        params: { id: product.id },
      });

    const named = await errorOf(await add({ sku: "LIP-2", nameAr: "وردي", nameEn: "Rose" }), 409);
    expect(named.details).toEqual({
      reason: "VARIANT_NAMES_REQUIRED",
      unnamedVariantIds: [product.variants[0].id],
    });

    await data(
      await call(patchVariant, `/admin/variants/${product.variants[0].id}`, {
        method: "PATCH",
        token: owner.token,
        body: { nameAr: "أحمر", nameEn: "Red" },
        params: { id: product.variants[0].id },
      }),
    );
    const unnamed = await errorOf(await add({ sku: "LIP-3" }), 409);
    expect(unnamed.details).toEqual({ reason: "VARIANT_NAMES_REQUIRED", unnamedVariantIds: [] });
    const second = await data(await add({ sku: "LIP-2", nameAr: "وردي", nameEn: "Rose" }), 201);

    // Clearing a name would leave two variants customers cannot tell apart.
    const cleared = await errorOf(
      await call(patchVariant, `/admin/variants/${second.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { nameAr: null, nameEn: null },
        params: { id: second.id },
      }),
      409,
    );
    expect(cleared.details.reason).toBe("VARIANT_NAMES_REQUIRED");
  });

  it("allows a single unnamed variant and unnamed variants on drafts", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    await data(
      await call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: owner.token,
        body: { sku: "DRAFT-2" },
        params: { id: product.id },
      }),
      201,
    );
  });
});

describe("slug lock", () => {
  it("keeps the slug locked after a published product goes back to draft", async () => {
    const owner = await staff("OWNER");
    const { product } = await readyProduct(owner.token);
    const edit = (slug: string) =>
      call(patchProduct, `/admin/products/${product.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { slug },
        params: { id: product.id },
      });
    expect((await data(await edit("never-published"))).slug).toBe("never-published");

    await data(await transition("publish", owner.token, product.id));
    await data(await transition("unpublish", owner.token, product.id));
    const locked = await errorOf(await edit("after-publish"), 409);
    expect(locked.details.reason).toBe("SLUG_LOCKED");
  });
});

describe("archived products", () => {
  it("are read-only", async () => {
    const owner = await staff("OWNER");
    const { product } = await readyProduct(owner.token);
    await data(await transition("archive", owner.token, product.id));
    const edit = await errorOf(
      await call(patchProduct, `/admin/products/${product.id}`, {
        method: "PATCH",
        token: owner.token,
        body: { nameEn: "Changed" },
        params: { id: product.id },
      }),
      409,
    );
    expect(edit.details.reason).toBe("PRODUCT_ARCHIVED");
  });
});

describe("public images", () => {
  it("are public for published and archived products, private for draft and disabled", async () => {
    const owner = await staff("OWNER");
    const { product, image } = await readyProduct(owner.token);
    const anonymous = () =>
      call(fileContent, `/files/${image.mediaAssetId}/content`, {
        params: { id: image.mediaAssetId },
      });

    expect((await anonymous()).status).toBe(401);
    await data(await transition("publish", owner.token, product.id));
    expect((await anonymous()).status).toBe(200);
    await data(await transition("disable", owner.token, product.id));
    expect((await anonymous()).status).toBe(401);
    await data(await transition("archive", owner.token, product.id));
    const archived = await anonymous();
    expect(archived.status).toBe(200);
    expect(archived.headers.get("cache-control")).toBe("public, max-age=3600");
  });
});
