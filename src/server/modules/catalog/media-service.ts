import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import { assertProductChangeable, lockProduct } from "@/server/modules/catalog/product-guards";
import { lockAttachableAsset, mediaContentUrl } from "@/server/modules/media/uploads-service";
import { readMaxImagesPerProduct } from "@/server/modules/settings/settings";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Product images (TASK-016, Business Spec Q175-Q178, DB design §5
 * "product_media", ADR-0021).
 *
 * - Images are files uploaded through `/files` (API §28) that passed every
 *   check (`SAFE`). Managing them needs `MANAGE_PRODUCT_MEDIA` (Q175).
 * - An image belongs to the whole product or to one of its variants.
 * - A product with images always has exactly one main image: the first image
 *   becomes main, and when the main image is removed the next one takes its
 *   place. A published product keeps at least one image (Q178); a draft may
 *   have none until it is published (TASK-017 checks that).
 * - At most `catalog.max_images_per_product` current images (Q177).
 * - Removing an image hides it (`removed_at`); the row and the file are kept,
 *   so order history and audit entries can still show it.
 * - Every change writes an audit entry in its transaction; no approval
 *   requests (R19).
 */

export interface CatalogMediaActor {
  employeeId: string;
}

export interface ProductMediaView {
  id: string;
  productId: string;
  variantId: string | null;
  mediaAssetId: string;
  url: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sortOrder: number;
  isMain: boolean;
  altTextAr: string | null;
  altTextEn: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The main image as shown in product lists. */
export interface MainImageView {
  id: string;
  url: string;
  width: number;
  height: number;
  altTextAr: string | null;
  altTextEn: string | null;
}

export interface AddProductMediaInput {
  mediaAssetId: string;
  variantId?: string | null;
  altTextAr?: string | null;
  altTextEn?: string | null;
  isMain?: boolean;
}

export interface ProductMediaChanges {
  variantId?: string | null;
  altTextAr?: string | null;
  altTextEn?: string | null;
  isMain?: true;
}

type MediaRow = Prisma.ProductMediaGetPayload<{ include: { mediaAsset: true } }>;

export function toProductMediaView(row: MediaRow): ProductMediaView {
  return {
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    mediaAssetId: row.mediaAssetId,
    url: mediaContentUrl(row.mediaAssetId),
    mimeType: row.mediaAsset.mimeType,
    width: row.mediaAsset.width ?? 0,
    height: row.mediaAsset.height ?? 0,
    sizeBytes: row.mediaAsset.sizeBytes,
    sortOrder: row.sortOrder,
    isMain: row.isMain,
    altTextAr: row.altTextAr,
    altTextEn: row.altTextEn,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMainImageView(row: MediaRow): MainImageView {
  return {
    id: row.id,
    url: mediaContentUrl(row.mediaAssetId),
    width: row.mediaAsset.width ?? 0,
    height: row.mediaAsset.height ?? 0,
    altTextAr: row.altTextAr,
    altTextEn: row.altTextEn,
  };
}

/** The product's current images, in display order. */
export async function loadActiveMedia(tx: Db, productId: string): Promise<MediaRow[]> {
  return tx.productMedia.findMany({
    where: { productId, removedAt: null },
    include: { mediaAsset: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

/** What an audit entry records about a product image. */
function mediaSnapshot(row: Prisma.ProductMediaGetPayload<object>) {
  return {
    productId: row.productId,
    variantId: row.variantId,
    mediaAssetId: row.mediaAssetId,
    sortOrder: row.sortOrder,
    isMain: row.isMain,
    altTextAr: row.altTextAr,
    altTextEn: row.altTextEn,
    removed: row.removedAt !== null,
  };
}

function mediaNotFound(): AppError {
  return new AppError("NOT_FOUND", "Product image not found.");
}

/** The variant must be one of this product's active variants. */
async function assertVariantUsable(tx: Db, productId: string, variantId: string): Promise<void> {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true, status: true },
  });
  if (!variant || variant.productId !== productId) {
    throw validationError(
      "variantId",
      "variant_not_found",
      "The variant is not part of this product.",
    );
  }
  if (variant.status !== "ACTIVE") {
    throw conflict("This variant is archived.", { reason: "VARIANT_ARCHIVED" });
  }
}

/**
 * True when the file is a current image of a published product, which anyone
 * may see (the storefront). Other files need a staff session.
 */
export async function isPublishedProductImage(db: Db, mediaAssetId: string): Promise<boolean> {
  const count = await db.productMedia.count({
    where: { mediaAssetId, removedAt: null, product: { status: "PUBLISHED" } },
  });
  return count > 0;
}

export interface ProductMediaServiceDeps {
  db: PrismaClient;
  clock: Clock;
}

export function createProductMediaService(deps: ProductMediaServiceDeps) {
  const { db, clock } = deps;

  /** Renumbers the current images 0..n-1 in the given order. */
  async function renumber(tx: Db, rows: readonly { id: string; sortOrder: number }[], now: Date) {
    for (const [index, row] of rows.entries()) {
      if (row.sortOrder !== index) {
        await tx.productMedia.update({
          where: { id: row.id },
          data: { sortOrder: index, updatedAt: now },
        });
      }
    }
  }

  async function touchProduct(tx: Db, productId: string, now: Date) {
    await tx.product.update({ where: { id: productId }, data: { updatedAt: now } });
  }

  async function addMedia(
    actor: CatalogMediaActor,
    productId: string,
    input: AddProductMediaInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ProductMediaView> {
    const now = clock.now();
    const created = await runInTransaction(
      async (tx) => {
        const product = await lockProduct(tx, productId);
        assertProductChangeable(product);
        await lockAttachableAsset(tx, input.mediaAssetId, "PRODUCT_MEDIA");
        const current = await tx.productMedia.findMany({
          where: { productId, removedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        });
        if (current.some((row) => row.mediaAssetId === input.mediaAssetId)) {
          throw conflict("This image is already on the product.", {
            reason: "MEDIA_ALREADY_ATTACHED",
          });
        }
        const limit = await readMaxImagesPerProduct(tx, logger);
        if (current.length >= limit) {
          throw conflict(`A product can have at most ${limit} images.`, {
            reason: "IMAGE_LIMIT",
            limit,
          });
        }
        const variantId = input.variantId ?? null;
        if (variantId !== null) {
          await assertVariantUsable(tx, productId, variantId);
        }
        const previousMain = current.find((row) => row.isMain) ?? null;
        const isMain = previousMain === null || input.isMain === true;
        if (isMain && previousMain) {
          await tx.productMedia.update({
            where: { id: previousMain.id },
            data: { isMain: false, updatedAt: now },
          });
        }
        const row = await tx.productMedia.create({
          data: {
            productId,
            variantId,
            mediaAssetId: input.mediaAssetId,
            sortOrder: current.length,
            isMain,
            altTextAr: input.altTextAr ?? null,
            altTextEn: input.altTextEn ?? null,
            createdAt: now,
            updatedAt: now,
          },
          include: { mediaAsset: true },
        });
        await touchProduct(tx, productId, now);
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_MEDIA_ADDED",
          entityType: AUDIT_ENTITY_TYPES.productMedia,
          entityId: row.id,
          next: {
            ...mediaSnapshot(row),
            ...(isMain && previousMain ? { previousMainMediaId: previousMain.id } : {}),
          },
          correlationId,
          createdAt: now,
        });
        return row;
      },
      {},
      db,
    );
    logger.info("product media added", {
      productId,
      productMediaId: created.id,
      actorEmployeeId: actor.employeeId,
    });
    return toProductMediaView(created);
  }

  /** Locks the product and finds one of its current images. */
  async function lockMedia(tx: Db, productId: string, mediaId: string) {
    const product = await lockProduct(tx, productId);
    const media = await tx.productMedia.findUnique({
      where: { id: mediaId },
      include: { mediaAsset: true },
    });
    if (!media || media.productId !== productId || media.removedAt !== null) {
      throw mediaNotFound();
    }
    return { product, media };
  }

  async function updateMedia(
    actor: CatalogMediaActor,
    productId: string,
    mediaId: string,
    input: ProductMediaChanges,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ProductMediaView> {
    const now = clock.now();
    const { view, changed } = await runInTransaction(
      async (tx) => {
        const { product, media } = await lockMedia(tx, productId, mediaId);
        assertProductChangeable(product);
        const data: Prisma.ProductMediaUncheckedUpdateInput = {};
        if (input.variantId !== undefined && input.variantId !== media.variantId) {
          if (input.variantId !== null) {
            await assertVariantUsable(tx, productId, input.variantId);
          }
          data.variantId = input.variantId;
        }
        if (input.altTextAr !== undefined && input.altTextAr !== media.altTextAr) {
          data.altTextAr = input.altTextAr;
        }
        if (input.altTextEn !== undefined && input.altTextEn !== media.altTextEn) {
          data.altTextEn = input.altTextEn;
        }
        const movesMain = input.isMain === true && !media.isMain;
        if (Object.keys(data).length === 0 && !movesMain) {
          return { view: toProductMediaView(media), changed: false };
        }
        let previousMainId: string | null = null;
        if (movesMain) {
          const previousMain = await tx.productMedia.findFirst({
            where: { productId, removedAt: null, isMain: true },
            select: { id: true },
          });
          if (previousMain) {
            previousMainId = previousMain.id;
            await tx.productMedia.update({
              where: { id: previousMain.id },
              data: { isMain: false, updatedAt: now },
            });
          }
          data.isMain = true;
        }
        const updated = await tx.productMedia.update({
          where: { id: mediaId },
          data: { ...data, updatedAt: now },
          include: { mediaAsset: true },
        });
        await touchProduct(tx, productId, now);
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_MEDIA_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.productMedia,
          entityId: mediaId,
          previous: {
            ...mediaSnapshot(media),
            ...(previousMainId ? { previousMainMediaId: previousMainId } : {}),
          },
          next: mediaSnapshot(updated),
          correlationId,
          createdAt: now,
        });
        return { view: toProductMediaView(updated), changed: true };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("product media updated", {
        productId,
        productMediaId: mediaId,
        actorEmployeeId: actor.employeeId,
      });
    }
    return view;
  }

  /** Hides an image; returns the product's remaining images. */
  async function removeMedia(
    actor: CatalogMediaActor,
    productId: string,
    mediaId: string,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ProductMediaView[]> {
    const now = clock.now();
    const remaining = await runInTransaction(
      async (tx) => {
        const { product, media } = await lockMedia(tx, productId, mediaId);
        assertProductChangeable(product);
        const others = (await loadActiveMedia(tx, productId)).filter((row) => row.id !== mediaId);
        if (others.length === 0 && product.status === "PUBLISHED") {
          throw conflict(
            "A published product needs a main image. Add another image before removing this one.",
            { reason: "MAIN_IMAGE_REQUIRED" },
          );
        }
        const removed = await tx.productMedia.update({
          where: { id: mediaId },
          data: { removedAt: now, isMain: false, updatedAt: now },
        });
        let newMainId: string | null = null;
        if (media.isMain && others.length > 0) {
          newMainId = others[0].id;
          await tx.productMedia.update({
            where: { id: newMainId },
            data: { isMain: true, updatedAt: now },
          });
        }
        await renumber(tx, others, now);
        await touchProduct(tx, productId, now);
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_MEDIA_REMOVED",
          entityType: AUDIT_ENTITY_TYPES.productMedia,
          entityId: mediaId,
          previous: mediaSnapshot(media),
          next: { ...mediaSnapshot(removed), ...(newMainId ? { newMainMediaId: newMainId } : {}) },
          correlationId,
          createdAt: now,
        });
        return loadActiveMedia(tx, productId);
      },
      {},
      db,
    );
    logger.info("product media removed", {
      productId,
      productMediaId: mediaId,
      actorEmployeeId: actor.employeeId,
    });
    return remaining.map(toProductMediaView);
  }

  /** Puts the product's current images in the given order (every one listed once). */
  async function reorderMedia(
    actor: CatalogMediaActor,
    productId: string,
    mediaIds: readonly string[],
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ProductMediaView[]> {
    const now = clock.now();
    const { rows, changed } = await runInTransaction(
      async (tx) => {
        const product = await lockProduct(tx, productId);
        assertProductChangeable(product);
        const current = await loadActiveMedia(tx, productId);
        const currentIds = current.map((row) => row.id);
        const sameSet =
          mediaIds.length === currentIds.length && mediaIds.every((id) => currentIds.includes(id));
        if (!sameSet) {
          throw validationError(
            "mediaIds",
            "media_order_mismatch",
            "List every current image of the product exactly once.",
          );
        }
        if (mediaIds.every((id, index) => currentIds[index] === id)) {
          return { rows: current, changed: false };
        }
        const byId = new Map(current.map((row) => [row.id, row]));
        await renumber(
          tx,
          mediaIds.map((id) => byId.get(id)!),
          now,
        );
        await touchProduct(tx, productId, now);
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "PRODUCT_MEDIA_REORDERED",
          entityType: AUDIT_ENTITY_TYPES.product,
          entityId: productId,
          previous: { mediaIds: currentIds },
          next: { mediaIds: [...mediaIds] },
          correlationId,
          createdAt: now,
        });
        return { rows: await loadActiveMedia(tx, productId), changed: true };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("product media reordered", { productId, actorEmployeeId: actor.employeeId });
    }
    return rows.map(toProductMediaView);
  }

  return { addMedia, updateMedia, removeMedia, reorderMedia };
}

export type ProductMediaService = ReturnType<typeof createProductMediaService>;

let defaultService: ProductMediaService | undefined;

export function getProductMediaService(): ProductMediaService {
  defaultService ??= createProductMediaService({ db: getDb(), clock: systemClock });
  return defaultService;
}
