import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { MediaPurpose, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Logger } from "@/server/logging/logger";
import { generateToken, hashToken, isWellFormedToken } from "@/server/modules/auth/tokens";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import {
  IMAGE_EXTENSIONS,
  inspectImage,
  type ImageMimeType,
} from "@/server/modules/media/image-inspection";
import { builtInScanner, type MalwareScanner } from "@/server/modules/media/scanner";
import {
  MAX_IMAGE_SIDE,
  MAX_UPLOAD_BYTES,
  MIN_IMAGE_SIDE,
  type StartUploadInput,
} from "@/server/modules/media/schemas";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import {
  getBlockedUntil,
  recordHit,
  secondsUntil,
  type RateLimitPolicy,
} from "@/server/rate-limit/rate-limit";
import {
  getFileStorage,
  StoredObjectTooLargeError,
  type FileStorage,
} from "@/server/storage/storage";
import { MS_PER_HOUR, MS_PER_MINUTE, systemClock, type Clock } from "@/server/time/time";

/**
 * File uploads (API §28, Architecture §20, Q176, TASK-016, ADR-0021).
 *
 * 1. `startUpload` checks the declared file (type, size, name) and returns a
 *    short-lived, single-use upload authorization: where to send the bytes
 *    and which headers to send. The file is recorded as `PENDING`.
 * 2. The client sends the bytes there (`receiveUpload` for the local
 *    storage). The size is limited while receiving.
 * 3. `completeUpload` checks the stored file itself: real type from its
 *    content, size, dimensions and the security scan. It becomes `SAFE`, or
 *    `REJECTED` and its bytes are removed. Only `SAFE` files can be attached
 *    (product media) or served.
 *
 * Uploading needs the permission of the feature the file is for, and only
 * the employee who started an upload can complete it.
 */

/** How long an upload authorization stays valid (ADR-0021 §4). */
export const UPLOAD_TTL_MS = 15 * MS_PER_MINUTE;

/** Uploads one employee may start per hour (abuse guard, AGENTS.md "Security"). */
export const UPLOAD_START_LIMIT: RateLimitPolicy = {
  limit: 300,
  windowMs: MS_PER_HOUR,
  blockMs: 15 * MS_PER_MINUTE,
};

/** The permission needed to upload, attach and manage files of each purpose. */
export const PURPOSE_PERMISSION: Record<MediaPurpose, PermissionCode> = {
  PRODUCT_MEDIA: "MANAGE_PRODUCT_MEDIA",
};

/** Object key prefix per purpose. */
const PURPOSE_FOLDER: Record<MediaPurpose, string> = {
  PRODUCT_MEDIA: "product-media",
};

export const UPLOAD_TOKEN_HEADER = "x-upload-token";

/**
 * Received bytes wait under a staging key until the upload is completed; only
 * a file that passed every check is written under its object key. A late
 * resend can therefore never replace the bytes of a checked file.
 */
export function stagingKey(mediaAssetId: string): string {
  return `staging/${mediaAssetId}.upload`;
}

export interface UploadActor {
  employeeId: string;
  permissions: ReadonlySet<PermissionCode>;
}

export interface UploadAuthorization {
  mediaAssetId: string;
  upload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
}

export interface MediaAssetView {
  id: string;
  purpose: MediaPurpose;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  scanStatus: "PENDING" | "SAFE" | "REJECTED";
  url: string;
  createdAt: string;
  completedAt: string | null;
}

type MediaAssetRow = Prisma.MediaAssetGetPayload<object>;

/** Where a stored file is served (`GET /files/{id}/content`). */
export function mediaContentUrl(mediaAssetId: string): string {
  return `/api/v1/files/${mediaAssetId}/content`;
}

/** Staff who may see files of a purpose: for product images, anyone who can see products or manage their images. */
export function canViewPurpose(
  permissions: ReadonlySet<PermissionCode>,
  purpose: MediaPurpose,
): boolean {
  switch (purpose) {
    case "PRODUCT_MEDIA":
      return permissions.has("PRODUCT_VIEW") || permissions.has(PURPOSE_PERMISSION[purpose]);
  }
}

/**
 * Locks a file about to be attached by a feature and checks it is a `SAFE`
 * file of that purpose. `FOR SHARE` keeps it unchanged until the attaching
 * transaction ends.
 */
export async function lockAttachableAsset(
  tx: Db,
  mediaAssetId: string,
  purpose: MediaPurpose,
): Promise<void> {
  const rows = await tx.$queryRaw<{ purpose: string; scan_status: string }[]>`
    SELECT purpose::text, scan_status::text FROM media_assets
    WHERE id = ${mediaAssetId}::uuid FOR SHARE`;
  if (rows.length === 0 || rows[0].purpose !== purpose) {
    throw validationError(
      "mediaAssetId",
      "media_asset_not_found",
      "No uploaded file of this kind has this id.",
    );
  }
  if (rows[0].scan_status !== "SAFE") {
    throw conflict("This file has not passed the upload checks.", {
      reason: "MEDIA_NOT_READY",
      scanStatus: rows[0].scan_status,
    });
  }
}

export function toMediaAssetView(row: MediaAssetRow): MediaAssetView {
  return {
    id: row.id,
    purpose: row.purpose,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    scanStatus: row.scanStatus,
    url: mediaContentUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function rejected(code: string, message: string): AppError {
  return new AppError("VALIDATION_ERROR", "The file was refused.", {
    details: { issues: [{ path: "file", code, message }] },
  });
}

const REJECTION_MESSAGES: Record<string, string> = {
  file_empty: "The file is empty.",
  file_too_large: `The file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
  file_type_not_allowed: "Only JPEG, PNG and WebP images are accepted.",
  file_type_mismatch: "The file's content does not match its declared type.",
  file_corrupt: "The file is not a complete, valid image.",
  file_trailing_data:
    "The file has extra data after the image (for example a motion photo). Save it as a plain image and try again.",
  image_animated: "Animated images are not accepted.",
  image_too_small: `The image must be at least ${MIN_IMAGE_SIDE} × ${MIN_IMAGE_SIDE} pixels.`,
  image_too_large: `The image must be at most ${MAX_IMAGE_SIDE} × ${MAX_IMAGE_SIDE} pixels.`,
  file_content_suspicious: "The file contains content that is not allowed in an image.",
};

function rejection(code: string): AppError {
  return rejected(code, REJECTION_MESSAGES[code] ?? "The file was refused.");
}

function uploadNotFound(): AppError {
  return new AppError("NOT_FOUND", "Upload not found.");
}

function invalidUploadToken(): AppError {
  return new AppError("FORBIDDEN", "The upload authorization is invalid.");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The checks of `completeUpload`: the problem found, or what the image is. */
async function checkFile(
  bytes: Buffer,
  declaredType: string,
  scanner: MalwareScanner,
): Promise<{ problem: string } | { mimeType: ImageMimeType; width: number; height: number }> {
  if (bytes.length === 0) {
    return { problem: "file_empty" };
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { problem: "file_too_large" };
  }
  const image = inspectImage(bytes);
  if (!image.ok) {
    return { problem: image.problem };
  }
  if (image.mimeType !== declaredType) {
    return { problem: "file_type_mismatch" };
  }
  if (image.width < MIN_IMAGE_SIDE || image.height < MIN_IMAGE_SIDE) {
    return { problem: "image_too_small" };
  }
  if (image.width > MAX_IMAGE_SIDE || image.height > MAX_IMAGE_SIDE) {
    return { problem: "image_too_large" };
  }
  const scan = await scanner.scan(bytes);
  if (!scan.safe) {
    return { problem: scan.reason };
  }
  return image;
}

export interface UploadsServiceDeps {
  db: PrismaClient;
  storage: FileStorage;
  scanner: MalwareScanner;
  clock: Clock;
}

export function createUploadsService(deps: UploadsServiceDeps) {
  const { db, storage, scanner, clock } = deps;

  function assertPurposeAllowed(actor: UploadActor, purpose: MediaPurpose): void {
    const required = PURPOSE_PERMISSION[purpose];
    if (!actor.permissions.has(required)) {
      throw new AppError("PERMISSION_DENIED", "You do not have permission to do this.", {
        details: { requiredPermissions: [required] },
      });
    }
  }

  async function startUpload(
    actor: UploadActor,
    input: StartUploadInput,
    logger: Logger,
  ): Promise<UploadAuthorization> {
    assertPurposeAllowed(actor, input.purpose);
    const now = clock.now();
    const limitKey = `upload-start:employee:${actor.employeeId}`;
    const blockedUntil = await getBlockedUntil(db, limitKey, now);
    if (blockedUntil) {
      throw new AppError("RATE_LIMITED", "Too many uploads. Try again later.", {
        details: { retryAfterSeconds: secondsUntil(blockedUntil, now) },
      });
    }
    await recordHit(db, limitKey, UPLOAD_START_LIMIT, now);

    const token = generateToken("upload");
    const extension = IMAGE_EXTENSIONS[input.mimeType][0];
    const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
    const asset = await db.mediaAsset.create({
      data: {
        storageProvider: storage.provider,
        objectKey: `${PURPOSE_FOLDER[input.purpose]}/${randomUUID()}.${extension}`,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        purpose: input.purpose,
        scanStatus: "PENDING",
        uploadTokenHash: hashToken(token),
        uploadExpiresAt: expiresAt,
        createdByEmployeeId: actor.employeeId,
        createdAt: now,
      },
    });
    logger.info("upload started", {
      mediaAssetId: asset.id,
      purpose: input.purpose,
      actorEmployeeId: actor.employeeId,
    });
    return {
      mediaAssetId: asset.id,
      upload: {
        method: "PUT",
        url: `/api/v1/files/uploads/${asset.id}`,
        headers: { "content-type": input.mimeType, [UPLOAD_TOKEN_HEADER]: token },
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /**
   * Stores the bytes of a pending upload (local storage only). Authorized by
   * the upload token, not a session, like an object storage upload link.
   * Sending again before completing replaces the earlier bytes.
   */
  async function receiveUpload(
    mediaAssetId: string,
    request: {
      token: string | null;
      contentType: string | null;
      contentLength: string | null;
      body: ReadableStream<Uint8Array> | null;
    },
    logger: Logger,
  ): Promise<void> {
    const { token } = request;
    if (!token || !isWellFormedToken("upload", token)) {
      throw invalidUploadToken();
    }
    const asset = await db.mediaAsset.findUnique({ where: { id: mediaAssetId } });
    if (
      !asset ||
      asset.uploadTokenHash === null ||
      !sameHash(asset.uploadTokenHash, hashToken(token))
    ) {
      throw invalidUploadToken();
    }
    const now = clock.now();
    if (asset.scanStatus !== "PENDING") {
      throw conflict("This upload is already completed.", { reason: "UPLOAD_CLOSED" });
    }
    if (asset.uploadExpiresAt <= now) {
      throw conflict("The upload authorization has expired. Start the upload again.", {
        reason: "UPLOAD_EXPIRED",
      });
    }
    const contentType = request.contentType?.split(";")[0].trim().toLowerCase() ?? null;
    if (contentType !== asset.mimeType) {
      throw new AppError("VALIDATION_ERROR", "Request validation failed.", {
        details: {
          issues: [
            {
              path: "content-type",
              code: "content_type_mismatch",
              message: `Send the file with Content-Type: ${asset.mimeType}.`,
            },
          ],
        },
      });
    }
    if (!request.body) {
      throw rejection("file_empty");
    }
    const tooLarge = () =>
      rejected("file_too_large", "The file is larger than the size given when the upload started.");
    // Refused before reading when the client announces the size; otherwise
    // the size is counted while the bytes arrive.
    if (request.contentLength !== null && Number(request.contentLength) > asset.sizeBytes) {
      throw tooLarge();
    }
    const staging = stagingKey(asset.id);
    let size: number;
    try {
      size = await storage.put(staging, request.body, asset.sizeBytes);
    } catch (error) {
      if (error instanceof StoredObjectTooLargeError) {
        throw tooLarge();
      }
      throw error;
    }
    if (size === 0) {
      await storage.remove(staging);
      throw rejection("file_empty");
    }
    // Recorded only while the upload is still open. If a completion won the
    // race, these late bytes are not needed.
    const { count } = await db.mediaAsset.updateMany({
      where: { id: asset.id, scanStatus: "PENDING" },
      data: { uploadedAt: clock.now() },
    });
    if (count === 0) {
      await storage.remove(staging);
      throw conflict("This upload is already completed.", { reason: "UPLOAD_CLOSED" });
    }
    logger.info("upload received", { mediaAssetId: asset.id, sizeBytes: size });
  }

  async function completeUpload(
    actor: UploadActor,
    mediaAssetId: string,
    logger: Logger,
  ): Promise<MediaAssetView> {
    const outcome = await runInTransaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM media_assets WHERE id = ${mediaAssetId}::uuid FOR UPDATE`;
        if (locked.length === 0) {
          throw uploadNotFound();
        }
        const asset = await tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaAssetId } });
        // Only the employee who started an upload completes it.
        if (asset.createdByEmployeeId !== actor.employeeId) {
          throw uploadNotFound();
        }
        assertPurposeAllowed(actor, asset.purpose);
        if (asset.scanStatus === "SAFE") {
          return { kind: "done" as const, asset };
        }
        if (asset.scanStatus === "REJECTED") {
          throw conflict("This file was refused. Upload it again after fixing it.", {
            reason: "UPLOAD_REJECTED",
            rejectionReason: asset.rejectionReason,
          });
        }
        const now = clock.now();
        const bytes = asset.uploadedAt ? await storage.read(stagingKey(asset.id)) : null;
        if (bytes === null) {
          if (asset.uploadExpiresAt <= now) {
            throw conflict("The upload authorization has expired. Start the upload again.", {
              reason: "UPLOAD_EXPIRED",
            });
          }
          throw conflict("No file has been received for this upload yet.", {
            reason: "UPLOAD_NOT_RECEIVED",
          });
        }
        const result = await checkFile(bytes, asset.mimeType, scanner);
        if ("problem" in result) {
          const updated = await tx.mediaAsset.update({
            where: { id: asset.id },
            data: {
              scanStatus: "REJECTED",
              rejectionReason: result.problem,
              sizeBytes: Math.max(bytes.length, 1),
              uploadTokenHash: null,
              completedAt: now,
            },
          });
          return { kind: "rejected" as const, asset: updated, problem: result.problem };
        }
        await storage.put(
          asset.objectKey,
          new Blob([new Uint8Array(bytes)]).stream(),
          bytes.length,
        );
        const updated = await tx.mediaAsset.update({
          where: { id: asset.id },
          data: {
            scanStatus: "SAFE",
            mimeType: result.mimeType,
            sizeBytes: bytes.length,
            width: result.width,
            height: result.height,
            checksum: createHash("sha256").update(bytes).digest("hex"),
            uploadTokenHash: null,
            completedAt: now,
          },
        });
        return { kind: "safe" as const, asset: updated };
      },
      {},
      db,
    );
    if (outcome.kind !== "done") {
      // Refused bytes are not kept (the row records why); accepted ones now
      // live under the object key.
      await storage.remove(stagingKey(outcome.asset.id));
    }
    if (outcome.kind === "rejected") {
      logger.warn("upload rejected", {
        mediaAssetId: outcome.asset.id,
        reason: outcome.problem,
        actorEmployeeId: actor.employeeId,
      });
      throw rejection(outcome.problem);
    }
    if (outcome.kind === "safe") {
      logger.info("upload completed", {
        mediaAssetId: outcome.asset.id,
        actorEmployeeId: actor.employeeId,
      });
    }
    return toMediaAssetView(outcome.asset);
  }

  /** A checked (`SAFE`) file, or null. Who may see it is decided by the caller. */
  async function findServableAsset(mediaAssetId: string): Promise<MediaAssetRow | null> {
    const asset = await db.mediaAsset.findUnique({ where: { id: mediaAssetId } });
    return asset && asset.scanStatus === "SAFE" ? asset : null;
  }

  async function readContent(asset: MediaAssetRow): Promise<Buffer | null> {
    return storage.read(asset.objectKey);
  }

  return {
    startUpload,
    receiveUpload,
    completeUpload,
    findServableAsset,
    readContent,
  };
}

export type UploadsService = ReturnType<typeof createUploadsService>;

let defaultService: UploadsService | undefined;

export function getUploadsService(): UploadsService {
  defaultService ??= createUploadsService({
    db: getDb(),
    storage: getFileStorage(),
    scanner: builtInScanner,
    clock: systemClock,
  });
  return defaultService;
}
