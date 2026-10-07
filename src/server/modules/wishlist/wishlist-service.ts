import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import { addToCustomerCart, type CartView } from "@/server/modules/cart/cart-service";
import { conflict } from "@/server/modules/catalog/errors";
import { variantNotFound } from "@/server/modules/catalog/product-guards";
import { localName } from "@/server/modules/locations/locations-service";
import { mediaContentUrl } from "@/server/modules/media/uploads-service";
import { toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Customer wishlist (TASK-042, API §19, DB design §15, Business Spec Q4,
 * Q47, Q48, ADR-0041).
 *
 * - Account-only (Q4): every call is for a signed-in customer.
 * - Only active variants of published products can be added, in stock or
 *   not. Items stay when the variant later sells out (`OUT_OF_STOCK`, shown
 *   as Coming Soon / Notify Me, Q47) or stops being sellable (`UNAVAILABLE`,
 *   Q48). Being on the wishlist never subscribes to restock (Q47, Q51).
 * - Move-to-cart adds one unit with the cart's rules and removes the item,
 *   in one transaction.
 * - Writes lock the customer row first, the same lock the cart takes.
 */

/** Technical limit on items (ADR-0041). */
export const MAX_WISHLIST_ITEMS = 100;

export type WishlistItemStatus = "AVAILABLE" | "OUT_OF_STOCK" | "UNAVAILABLE";

export interface WishlistItemView {
  id: string;
  productId: string;
  variantId: string;
  slug: string;
  sku: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  /** Current selling price; null when the item is unavailable. */
  unitPrice: number | null;
  status: WishlistItemStatus;
  addedAt: string;
}

export interface WishlistView {
  /** Null until the first item is added. */
  id: string | null;
  items: WishlistItemView[];
  itemCount: number;
}

const ITEM_INCLUDE = {
  variant: {
    include: {
      inventoryBalance: true,
      product: { include: { media: { where: { isMain: true, removedAt: null } } } },
    },
  },
} as const;

type ItemRow = Prisma.WishlistItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

function itemNotFound(): AppError {
  return new AppError("NOT_FOUND", "Wishlist item not found.");
}

function toItemView(row: ItemRow, locale: SupportedLocale): WishlistItemView {
  const { variant } = row;
  const { product } = variant;
  const sellable =
    variant.status === "ACTIVE" && product.status === "PUBLISHED" && variant.sellingPrice !== null;
  const stock = variant.inventoryBalance?.availableQuantity ?? 0;
  return {
    id: row.id,
    productId: product.id,
    variantId: variant.id,
    slug: product.slug,
    sku: variant.sku,
    name: localName(product, locale),
    variantName: locale === "ar" ? variant.variantNameAr : variant.variantNameEn,
    imageUrl: product.media[0] ? mediaContentUrl(product.media[0].mediaAssetId) : null,
    unitPrice: sellable ? toJsonNumber(variant.sellingPrice!) : null,
    status: !sellable ? "UNAVAILABLE" : stock > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
    addedAt: row.createdAt.toISOString(),
  };
}

async function loadView(
  db: Db,
  customerId: string,
  locale: SupportedLocale,
): Promise<WishlistView> {
  const wishlist = await db.wishlist.findUnique({
    where: { customerId },
    include: {
      items: { include: ITEM_INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });
  const items = wishlist?.items.map((row) => toItemView(row, locale)) ?? [];
  return { id: wishlist?.id ?? null, items, itemCount: items.length };
}

async function lockCustomer(tx: Db, customerId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
}

export function createWishlistService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  function getWishlist(customerId: string, locale: SupportedLocale): Promise<WishlistView> {
    return loadView(db, customerId, locale);
  }

  /** Adds a variant; adding one already on the wishlist changes nothing. */
  async function addItem(
    customerId: string,
    variantId: string,
    locale: SupportedLocale,
  ): Promise<WishlistView> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        await lockCustomer(tx, customerId);
        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: { status: true, product: { select: { status: true } } },
        });
        if (variant?.status !== "ACTIVE" || variant.product.status !== "PUBLISHED") {
          throw variantNotFound();
        }
        const wishlist =
          (await tx.wishlist.findUnique({ where: { customerId } })) ??
          (await tx.wishlist.create({ data: { customerId, createdAt: now, updatedAt: now } }));
        const existing = await tx.wishlistItem.findUnique({
          where: {
            wishlistId_productVariantId: { wishlistId: wishlist.id, productVariantId: variantId },
          },
        });
        if (!existing) {
          if (
            (await tx.wishlistItem.count({ where: { wishlistId: wishlist.id } })) >=
            MAX_WISHLIST_ITEMS
          ) {
            throw conflict(`A wishlist can hold up to ${MAX_WISHLIST_ITEMS} items.`, {
              reason: "WISHLIST_LIMIT_REACHED",
              limit: MAX_WISHLIST_ITEMS,
            });
          }
          await tx.wishlistItem.create({
            data: { wishlistId: wishlist.id, productVariantId: variantId, createdAt: now },
          });
          await tx.wishlist.update({ where: { id: wishlist.id }, data: { updatedAt: now } });
        }
        return loadView(tx, customerId, locale);
      },
      {},
      db,
    );
  }

  /** Deletes the customer's own item, or throws `NOT_FOUND`. */
  async function takeItem(tx: Db, customerId: string, itemId: string, now: Date) {
    await lockCustomer(tx, customerId);
    const item = await tx.wishlistItem.findFirst({
      where: { id: itemId, wishlist: { customerId } },
    });
    if (!item) {
      throw itemNotFound();
    }
    await tx.wishlistItem.delete({ where: { id: item.id } });
    await tx.wishlist.update({ where: { id: item.wishlistId }, data: { updatedAt: now } });
    return item;
  }

  async function removeItem(
    customerId: string,
    itemId: string,
    locale: SupportedLocale,
  ): Promise<WishlistView> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        await takeItem(tx, customerId, itemId, now);
        return loadView(tx, customerId, locale);
      },
      {},
      db,
    );
  }

  /**
   * Adds one unit to the customer's cart (cart rules: purchasable, in stock,
   * line limit) and removes the item. On any refusal nothing changes.
   */
  async function moveToCart(
    customerId: string,
    itemId: string,
    locale: SupportedLocale,
  ): Promise<{ cart: CartView; wishlist: WishlistView }> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        const item = await takeItem(tx, customerId, itemId, now);
        const cart = await addToCustomerCart(
          tx,
          customerId,
          { variantId: item.productVariantId, quantity: 1 },
          locale,
          now,
        );
        return { cart, wishlist: await loadView(tx, customerId, locale) };
      },
      {},
      db,
    );
  }

  return { getWishlist, addItem, removeItem, moveToCart };
}

export type WishlistService = ReturnType<typeof createWishlistService>;

let defaultService: WishlistService | undefined;

export function getWishlistService(): WishlistService {
  defaultService ??= createWishlistService({ db: getDb(), clock: systemClock });
  return defaultService;
}
