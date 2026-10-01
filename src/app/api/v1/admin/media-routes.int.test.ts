import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PUT as reorderMedia } from "@/app/api/v1/admin/products/[id]/media/order/route";
import {
  DELETE as removeMedia,
  PATCH as patchMedia,
} from "@/app/api/v1/admin/products/[id]/media/[mediaId]/route";
import { POST as addMedia } from "@/app/api/v1/admin/products/[id]/media/route";
import { GET as productDetail } from "@/app/api/v1/admin/products/[id]/route";
import { POST as createVariant } from "@/app/api/v1/admin/products/[id]/variants/route";
import { GET as listProducts, POST as createProduct } from "@/app/api/v1/admin/products/route";
import { GET as fileContent } from "@/app/api/v1/files/[id]/content/route";
import { POST as completeUpload } from "@/app/api/v1/files/complete/route";
import { POST as uploadInit } from "@/app/api/v1/files/upload-init/route";
import { PUT as uploadBytes } from "@/app/api/v1/files/uploads/[id]/route";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createSession } from "@/server/modules/auth/sessions";
import { EMPLOYEE_COOKIES } from "@/server/modules/auth/transport";
import { stagingKey } from "@/server/modules/media/uploads-service";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { SETTING_KEYS } from "@/server/modules/settings/settings";
import { getFileStorage } from "@/server/storage/storage";
import { MS_PER_HOUR } from "@/server/time/time";
import { jpeg, png, webp } from "@/test/fixtures/images";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of file uploads (API §28) and product media (API §13,
 * "TASK-016 Amendments"), with the local file storage in a throwaway
 * directory.
 */

const db = getDb();
const storage = getFileStorage();
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
      email: `media${counter}@beautyfits.example`,
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

interface Started {
  mediaAssetId: string;
  upload: { method: string; url: string; headers: Record<string, string>; expiresAt: string };
}

async function start(
  token: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<Started> {
  return data(
    await call(uploadInit, "/files/upload-init", {
      method: "POST",
      token,
      body: { purpose: "PRODUCT_MEDIA", ...file },
    }),
    201,
  );
}

function send(
  started: Started,
  bytes: Buffer,
  headers: Record<string, string> = started.upload.headers,
) {
  return call(uploadBytes, `/files/uploads/${started.mediaAssetId}`, {
    method: "PUT",
    headers,
    rawBody: bytes,
    params: { id: started.mediaAssetId },
  });
}

function complete(token: string, mediaAssetId: string) {
  return call(completeUpload, "/files/complete", {
    method: "POST",
    token,
    body: { mediaAssetId },
  });
}

const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** Uploads a file through all three steps; returns the completed asset. */
async function upload(token: string, bytes: Buffer, mimeType: keyof typeof TYPES = "image/png") {
  const started = await start(token, {
    filename: `photo.${TYPES[mimeType]}`,
    mimeType,
    sizeBytes: bytes.length,
  });
  expect((await send(started, bytes)).status).toBe(204);
  return data(await complete(token, started.mediaAssetId));
}

async function newProduct(token: string, nameEn = "Matte Lipstick") {
  return data(
    await call(createProduct, "/admin/products", {
      method: "POST",
      token,
      body: { nameAr: "أحمر شفاه", nameEn, defaultVariant: { sku: `SKU-${++counter}` } },
    }),
    201,
  );
}

function attach(token: string, productId: string, body: Record<string, unknown>) {
  return call(addMedia, `/admin/products/${productId}/media`, {
    method: "POST",
    token,
    body,
    params: { id: productId },
  });
}

async function detail(token: string, productId: string) {
  return data(
    await call(productDetail, `/admin/products/${productId}`, { token, params: { id: productId } }),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await rm(getEnv().MEDIA_DIR, { recursive: true, force: true });
  await db.$disconnect();
});

describe("uploads", () => {
  it("checks the file and records its real size, dimensions and checksum", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const bytes = png(800, 600);
    const started = await start(editor.token, {
      filename: "C:\\photos\\Rose.PNG",
      mimeType: "image/png",
      sizeBytes: bytes.length,
    });
    expect(started.upload).toMatchObject({
      method: "PUT",
      url: `/api/v1/files/uploads/${started.mediaAssetId}`,
      headers: { "content-type": "image/png" },
    });
    expect(started.upload.headers["x-upload-token"]).toMatch(/^bfu_/);
    const pending = await db.mediaAsset.findUniqueOrThrow({ where: { id: started.mediaAssetId } });
    expect(pending).toMatchObject({
      scanStatus: "PENDING",
      originalFilename: "Rose.PNG",
      storageProvider: "LOCAL",
      createdByEmployeeId: editor.employee.id,
    });
    // Only the hash of the token is stored.
    expect(pending.uploadTokenHash).not.toContain("bfu_");

    expect((await send(started, bytes)).status).toBe(204);
    const asset = await data(await complete(editor.token, started.mediaAssetId));
    expect(asset).toMatchObject({
      id: started.mediaAssetId,
      purpose: "PRODUCT_MEDIA",
      originalFilename: "Rose.PNG",
      mimeType: "image/png",
      sizeBytes: bytes.length,
      width: 800,
      height: 600,
      scanStatus: "SAFE",
      url: `/api/v1/files/${started.mediaAssetId}/content`,
    });
    const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(row.uploadTokenHash).toBeNull();
    expect(row.objectKey).toMatch(/^product-media\/[0-9a-f-]+\.png$/);
    expect(await storage.read(row.objectKey)).toEqual(bytes);
    expect(await storage.read(stagingKey(asset.id))).toBeNull();

    // Completing again returns the same result; the token cannot be reused.
    expect(await data(await complete(editor.token, asset.id))).toEqual(asset);
    expect((await send(started, png(900, 900))).status).toBe(403);
    expect(await storage.read(row.objectKey)).toEqual(bytes);
  });

  it("accepts JPEG and WebP images", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    expect(await upload(editor.token, jpeg(1000, 1500), "image/jpeg")).toMatchObject({
      mimeType: "image/jpeg",
      width: 1000,
      height: 1500,
    });
    expect(await upload(editor.token, webp(600, 600), "image/webp")).toMatchObject({
      mimeType: "image/webp",
      width: 600,
    });
  });

  it("needs MANAGE_PRODUCT_MEDIA and a session; cookie requests need the Origin check", async () => {
    const body = {
      purpose: "PRODUCT_MEDIA",
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: 10,
    };
    expect((await call(uploadInit, "/files/upload-init", { method: "POST", body })).status).toBe(
      401,
    );
    const viewer = await staff("EMPLOYEE", ["PRODUCT_VIEW", "PRODUCT_EDIT"]);
    const denied = await errorOf(
      await call(uploadInit, "/files/upload-init", { method: "POST", token: viewer.token, body }),
      403,
    );
    expect(denied).toMatchObject({
      code: "PERMISSION_DENIED",
      details: { requiredPermissions: ["MANAGE_PRODUCT_MEDIA"] },
    });
    const owner = await staff("OWNER");
    const cookie = `${EMPLOYEE_COOKIES.access}=${owner.token}`;
    expect(
      (await call(uploadInit, "/files/upload-init", { method: "POST", headers: { cookie }, body }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(uploadInit, "/files/upload-init", {
          method: "POST",
          headers: { cookie, origin: SAME_ORIGIN },
          body,
        })
      ).status,
    ).toBe(201);
  });

  it("refuses declared files that are too big, of another type or misnamed", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    for (const [body, code] of [
      [{ filename: "a.png", mimeType: "image/png", sizeBytes: 5 * 1024 * 1024 + 1 }, "too_big"],
      [{ filename: "a.svg", mimeType: "image/svg+xml", sizeBytes: 100 }, "invalid_value"],
      [{ filename: "a.jpg", mimeType: "image/png", sizeBytes: 100 }, "file_extension_mismatch"],
    ] as const) {
      const error = await errorOf(
        await call(uploadInit, "/files/upload-init", {
          method: "POST",
          token: editor.token,
          body: { purpose: "PRODUCT_MEDIA", ...body },
        }),
        400,
      );
      expect(JSON.stringify(error.details)).toContain(code);
    }
  });

  it("guards the upload link: token, content type, declared size and expiry", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const bytes = png(600, 600);
    const started = await start(editor.token, {
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
    });
    const token = started.upload.headers["x-upload-token"];
    expect((await send(started, bytes, { "content-type": "image/png" })).status).toBe(403);
    expect(
      (
        await send(started, bytes, {
          "content-type": "image/png",
          "x-upload-token": `${token.slice(0, -2)}xx`,
        })
      ).status,
    ).toBe(403);
    const wrongType = await errorOf(
      await send(started, bytes, { "content-type": "text/html", "x-upload-token": token }),
      400,
    );
    expect(wrongType.details.issues[0].code).toBe("content_type_mismatch");
    const tooBig = await errorOf(
      await send(started, Buffer.concat([bytes, Buffer.alloc(10)])),
      400,
    );
    expect(tooBig.details.issues[0].code).toBe("file_too_large");
    expect(await storage.read(stagingKey(started.mediaAssetId))).toBeNull();

    // Completing before any bytes arrived.
    const early = await errorOf(await complete(editor.token, started.mediaAssetId), 409);
    expect(early.details.reason).toBe("UPLOAD_NOT_RECEIVED");

    await db.mediaAsset.update({
      where: { id: started.mediaAssetId },
      data: { uploadExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await errorOf(await send(started, bytes), 409)).details.reason).toBe("UPLOAD_EXPIRED");
    expect(
      (await errorOf(await complete(editor.token, started.mediaAssetId), 409)).details.reason,
    ).toBe("UPLOAD_EXPIRED");
  });

  it("lets only the employee who started an upload complete it", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const other = await staff("OWNER");
    const bytes = png(600, 600);
    const started = await start(editor.token, {
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
    });
    await send(started, bytes);
    expect((await complete(other.token, started.mediaAssetId)).status).toBe(404);
    expect((await complete(other.token, UNKNOWN_ID)).status).toBe(404);
    expect((await complete(editor.token, started.mediaAssetId)).status).toBe(200);
  });

  it("rejects files whose content fails the checks and removes their bytes", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const cases: [Buffer, keyof typeof TYPES, string][] = [
      [jpeg(600, 600), "image/png", "file_type_mismatch"],
      [png(300, 800), "image/png", "image_too_small"],
      [jpeg(6001, 1000), "image/jpeg", "image_too_large"],
      [Buffer.from("<html><script>alert(1)</script></html>"), "image/png", "file_type_not_allowed"],
      [jpeg(600, 600, { comment: "<?php echo 1; ?>" }), "image/jpeg", "file_content_suspicious"],
      [
        Buffer.concat([png(600, 600), Buffer.from("PK\x03\x04zip")]),
        "image/png",
        "file_trailing_data",
      ],
    ];
    for (const [bytes, mimeType, code] of cases) {
      const started = await start(editor.token, {
        filename: `bad.${TYPES[mimeType]}`,
        mimeType,
        sizeBytes: bytes.length,
      });
      expect((await send(started, bytes)).status).toBe(204);
      const error = await errorOf(await complete(editor.token, started.mediaAssetId), 400);
      expect(error.details.issues[0]).toMatchObject({ path: "file", code });
      const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: started.mediaAssetId } });
      expect(row).toMatchObject({ scanStatus: "REJECTED", rejectionReason: code });
      expect(await storage.read(stagingKey(row.id))).toBeNull();
      expect(await storage.read(row.objectKey)).toBeNull();
      const again = await errorOf(await complete(editor.token, started.mediaAssetId), 409);
      expect(again.details).toMatchObject({ reason: "UPLOAD_REJECTED", rejectionReason: code });
    }
  });

  it("limits how many uploads one employee can start", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    await db.rateLimitBucket.create({
      data: {
        key: `upload-start:employee:${editor.employee.id}`,
        count: 300,
        windowStartedAt: new Date(),
        blockedUntil: new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      },
    });
    const error = await errorOf(
      await call(uploadInit, "/files/upload-init", {
        method: "POST",
        token: editor.token,
        body: { purpose: "PRODUCT_MEDIA", filename: "a.png", mimeType: "image/png", sizeBytes: 10 },
      }),
      429,
    );
    expect(error.code).toBe("RATE_LIMITED");
  });
});

describe("product media", () => {
  it("attaches images, keeps one main image and shows them on the product", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await newProduct(editor.token);
    expect(product.media).toEqual([]);
    const first = await upload(editor.token, png(800, 800));
    const second = await upload(editor.token, png(600, 900));

    const res = await call(addMedia, `/admin/products/${product.id}/media`, {
      method: "POST",
      token: editor.token,
      headers: { "x-request-id": "req-media-1" },
      body: { mediaAssetId: first.id, altTextEn: " Rose shade ", altTextAr: "  " },
      params: { id: product.id },
    });
    const a = await data(res, 201);
    expect(a).toMatchObject({
      productId: product.id,
      variantId: null,
      mediaAssetId: first.id,
      url: first.url,
      width: 800,
      height: 800,
      sortOrder: 0,
      isMain: true,
      altTextEn: "Rose shade",
      altTextAr: null,
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PRODUCT_MEDIA_ADDED" } });
    expect(audit).toMatchObject({
      actorId: editor.employee.id,
      entityType: "PRODUCT_MEDIA",
      entityId: a.id,
      correlationId: "req-media-1",
    });

    const b = await data(
      await attach(editor.token, product.id, { mediaAssetId: second.id, isMain: true }),
      201,
    );
    expect(b).toMatchObject({ sortOrder: 1, isMain: true });
    const shown = await detail(editor.token, product.id);
    expect(shown.media.map((m: { id: string; isMain: boolean }) => [m.id, m.isMain])).toEqual([
      [a.id, false],
      [b.id, true],
    ]);
    const list = await data(await call(listProducts, "/admin/products", { token: editor.token }));
    expect(list[0].mainImage).toMatchObject({ id: b.id, url: second.url, width: 600, height: 900 });

    const twice = await errorOf(
      await attach(editor.token, product.id, { mediaAssetId: first.id }),
      409,
    );
    expect(twice.details.reason).toBe("MEDIA_ALREADY_ATTACHED");
    // The same file can illustrate another product.
    const other = await newProduct(editor.token, "Gloss");
    expect((await attach(editor.token, other.id, { mediaAssetId: first.id })).status).toBe(201);
  });

  it("refuses files that are unknown, not checked or refused", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await newProduct(editor.token);
    const unknown = await errorOf(
      await attach(editor.token, product.id, { mediaAssetId: UNKNOWN_ID }),
      400,
    );
    expect(unknown.details.issues[0].code).toBe("media_asset_not_found");
    const started = await start(editor.token, {
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: 10,
    });
    const pending = await errorOf(
      await attach(editor.token, product.id, { mediaAssetId: started.mediaAssetId }),
      409,
    );
    expect(pending.details).toMatchObject({ reason: "MEDIA_NOT_READY", scanStatus: "PENDING" });
    expect((await attach(editor.token, UNKNOWN_ID, { mediaAssetId: UNKNOWN_ID })).status).toBe(404);
  });

  it("links images to the product's own active variants", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await newProduct(editor.token);
    const other = await newProduct(editor.token, "Gloss");
    const shade = await data(
      await call(createVariant, `/admin/products/${product.id}/variants`, {
        method: "POST",
        token: editor.token,
        body: { sku: "ROSE-01", nameAr: "وردي", nameEn: "Rose" },
        params: { id: product.id },
      }),
      201,
    );
    const asset = await upload(editor.token, png(600, 600));
    const foreign = await errorOf(
      await attach(editor.token, product.id, {
        mediaAssetId: asset.id,
        variantId: other.variants[0].id,
      }),
      400,
    );
    expect(foreign.details.issues[0].code).toBe("variant_not_found");
    const linked = await data(
      await attach(editor.token, product.id, { mediaAssetId: asset.id, variantId: shade.id }),
      201,
    );
    expect(linked.variantId).toBe(shade.id);

    const moved = await data(
      await call(patchMedia, `/admin/products/${product.id}/media/${linked.id}`, {
        method: "PATCH",
        token: editor.token,
        body: { variantId: null, altTextAr: "أحمر شفاه وردي" },
        params: { id: product.id, mediaId: linked.id },
      }),
    );
    expect(moved).toMatchObject({ variantId: null, altTextAr: "أحمر شفاه وردي" });
    const updated = await db.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_MEDIA_UPDATED" },
    });
    expect(updated.previousDataJson).toMatchObject({ variantId: shade.id });
    expect(updated.newDataJson).toMatchObject({ variantId: null });

    // A change that changes nothing writes no audit entry.
    await call(patchMedia, `/admin/products/${product.id}/media/${linked.id}`, {
      method: "PATCH",
      token: editor.token,
      body: { variantId: null },
      params: { id: product.id, mediaId: linked.id },
    });
    expect(await db.auditLog.count({ where: { action: "PRODUCT_MEDIA_UPDATED" } })).toBe(1);
  });

  it("reorders, moves the main image and keeps removed images for history", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await newProduct(editor.token);
    const media = [];
    for (let i = 0; i < 3; i += 1) {
      const asset = await upload(editor.token, png(600 + i, 600));
      media.push(
        await data(await attach(editor.token, product.id, { mediaAssetId: asset.id }), 201),
      );
    }
    const [a, b, c] = media;
    const order = (mediaIds: string[]) =>
      call(reorderMedia, `/admin/products/${product.id}/media/order`, {
        method: "PUT",
        token: editor.token,
        body: { mediaIds },
        params: { id: product.id },
      });
    const reordered = await data(await order([c.id, a.id, b.id]));
    expect(reordered.map((m: { id: string; sortOrder: number }) => [m.id, m.sortOrder])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
    const missing = await errorOf(await order([c.id, a.id]), 400);
    expect(missing.details.issues[0].code).toBe("media_order_mismatch");
    expect((await order([c.id, a.id, a.id])).status).toBe(400);
    expect(await db.auditLog.count({ where: { action: "PRODUCT_MEDIA_REORDERED" } })).toBe(1);

    // Removing the main image (a) makes the first remaining one (c) main.
    const remaining = await data(
      await call(removeMedia, `/admin/products/${product.id}/media/${a.id}`, {
        method: "DELETE",
        token: editor.token,
        params: { id: product.id, mediaId: a.id },
      }),
    );
    expect(
      remaining.map((m: { id: string; isMain: boolean; sortOrder: number }) => [
        m.id,
        m.isMain,
        m.sortOrder,
      ]),
    ).toEqual([
      [c.id, true, 0],
      [b.id, false, 1],
    ]);
    const removedRow = await db.productMedia.findUniqueOrThrow({
      where: { id: a.id },
      include: { mediaAsset: true },
    });
    expect(removedRow.removedAt).not.toBeNull();
    expect(removedRow.isMain).toBe(false);
    expect(await storage.read(removedRow.mediaAsset.objectKey)).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "PRODUCT_MEDIA_REMOVED" },
    });
    expect(audit.newDataJson).toMatchObject({ removed: true, newMainMediaId: c.id });
    const again = await call(removeMedia, `/admin/products/${product.id}/media/${a.id}`, {
      method: "DELETE",
      token: editor.token,
      params: { id: product.id, mediaId: a.id },
    });
    expect(again.status).toBe(404);

    await expect(db.productMedia.delete({ where: { id: a.id } })).rejects.toThrow();
    await expect(db.mediaAsset.delete({ where: { id: a.mediaAssetId } })).rejects.toThrow();
  });

  it("limits images per product with the configurable setting", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    await db.setting.create({
      data: { key: SETTING_KEYS.catalogMaxImagesPerProduct, valueJson: 2, dataType: "INTEGER" },
    });
    const product = await newProduct(editor.token);
    for (let i = 0; i < 2; i += 1) {
      const asset = await upload(editor.token, png(600 + i, 600));
      expect((await attach(editor.token, product.id, { mediaAssetId: asset.id })).status).toBe(201);
    }
    const third = await upload(editor.token, png(700, 700));
    const error = await errorOf(
      await attach(editor.token, product.id, { mediaAssetId: third.id }),
      409,
    );
    expect(error.details).toEqual({ reason: "IMAGE_LIMIT", limit: 2 });
  });

  it("keeps a published product's last image and freezes archived products", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await newProduct(editor.token);
    const asset = await upload(editor.token, png(600, 600));
    const only = await data(
      await attach(editor.token, product.id, { mediaAssetId: asset.id }),
      201,
    );
    await db.product.update({ where: { id: product.id }, data: { status: "PUBLISHED" } });
    const kept = await errorOf(
      await call(removeMedia, `/admin/products/${product.id}/media/${only.id}`, {
        method: "DELETE",
        token: editor.token,
        params: { id: product.id, mediaId: only.id },
      }),
      409,
    );
    expect(kept.details.reason).toBe("MAIN_IMAGE_REQUIRED");

    await db.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
    const another = await upload(editor.token, png(650, 650));
    const frozen = await errorOf(
      await attach(editor.token, product.id, { mediaAssetId: another.id }),
      409,
    );
    expect(frozen.details.reason).toBe("PRODUCT_ARCHIVED");
  });

  it("gives one main image even when images are added at the same moment", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const product = await newProduct(editor.token);
    const assets = [
      await upload(editor.token, png(600, 600)),
      await upload(editor.token, png(601, 600)),
    ];
    const results = await Promise.all(
      assets.map((asset) => attach(editor.token, product.id, { mediaAssetId: asset.id })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const shown = await detail(editor.token, product.id);
    expect(shown.media.filter((m: { isMain: boolean }) => m.isMain)).toHaveLength(1);
    expect(shown.media.map((m: { sortOrder: number }) => m.sortOrder)).toEqual([0, 1]);
  });

  it("needs MANAGE_PRODUCT_MEDIA, not just product editing", async () => {
    const owner = await staff("OWNER");
    const product = await newProduct(owner.token);
    const asset = await upload(owner.token, png(600, 600));
    const productEditor = await staff("EMPLOYEE", ["PRODUCT_VIEW", "PRODUCT_EDIT"]);
    const denied = await attach(productEditor.token, product.id, { mediaAssetId: asset.id });
    expect(denied.status).toBe(403);
    expect((await attach("", product.id, { mediaAssetId: asset.id })).status).toBe(401);
  });
});

describe("serving files", () => {
  it("serves images to staff, and to everyone once the product is published", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const bytes = png(600, 600);
    const asset = await upload(editor.token, bytes);
    const get = (token?: string, headers?: Record<string, string>) =>
      call(fileContent, `/files/${asset.id}/content`, { token, headers, params: { id: asset.id } });

    const res = await get(editor.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    const etag = res.headers.get("etag")!;
    expect((await get(editor.token, { "if-none-match": etag })).status).toBe(304);

    // Not public while the product is a draft.
    expect((await get()).status).toBe(401);
    const noView = await staff("EMPLOYEE", ["ORDERS_VIEW"]);
    expect((await get(noView.token)).status).toBe(404);

    const product = await newProduct(editor.token);
    await data(await attach(editor.token, product.id, { mediaAssetId: asset.id }), 201);
    await db.product.update({ where: { id: product.id }, data: { status: "PUBLISHED" } });
    const open = await get();
    expect(open.status).toBe(200);
    expect(open.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("never serves files that are pending or refused", async () => {
    const editor = await staff("EMPLOYEE", CATALOG_EDITOR);
    const bytes = jpeg(600, 600);
    const started = await start(editor.token, {
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
    });
    await send(started, bytes);
    const get = () =>
      call(fileContent, `/files/${started.mediaAssetId}/content`, {
        token: editor.token,
        params: { id: started.mediaAssetId },
      });
    expect((await get()).status).toBe(404);
    await complete(editor.token, started.mediaAssetId);
    expect((await get()).status).toBe(404);
    expect(
      (
        await call(fileContent, "/files/not-a-uuid/content", {
          token: editor.token,
          params: { id: "x" },
        })
      ).status,
    ).toBe(404);
  });
});
