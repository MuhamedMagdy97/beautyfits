import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import { generateToken, hashToken } from "@/server/modules/auth/tokens";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import { variantNotFound } from "@/server/modules/catalog/product-guards";
import { localName } from "@/server/modules/locations/locations-service";
import { mediaContentUrl } from "@/server/modules/media/uploads-service";
import { add, multiply, toJsonNumber } from "@/server/money/money";
import { getBlockedUntil, recordHit, type RateLimitPolicy } from "@/server/rate-limit/rate-limit";
import type { AddCartItemInput, UpdateCartItemInput } from "@/server/modules/cart/schemas";
import {
  discountRefused,
  discountUsageCounts,
  loadDiscounts,
  type LoadedDiscount,
} from "@/server/modules/discounts/discounts-service";
import {
  evaluateDiscount,
  type DiscountLine,
  type DiscountProblem,
} from "@/server/modules/discounts/engine";
import type { ChooseCartDiscountInput } from "@/server/modules/discounts/schemas";
import { readGuestCartExpiryDays } from "@/server/modules/settings/settings";
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  systemClock,
  type Clock,
} from "@/server/time/time";

/**
 * Guest and customer carts (TASK-025, API §14, DB design §7, Q37, R33,
 * ADR-0031).
 *
 * - A cart holds intent, not trusted prices (User Flows §6.1): every read
 *   shows the current price and stock; checkout (TASK-029) revalidates all.
 * - `lastSeenUnitPrice` is the price the shopper last saw. A different
 *   current price sets `priceChanged` until `reprice` acknowledges it (Q37).
 * - Only active variants of published products with a selling price can be
 *   added; a quantity above the available stock is refused. Lines that stop
 *   being purchasable stay in the cart, marked `UNAVAILABLE`.
 * - Guest carts expire after the configured days without changes (R35,
 *   default 30); customer carts never expire.
 * - Discounts (TASK-026, Q125, Q138, R36): the shopper chooses one; codeless
 *   offers that apply are listed in `availableDiscounts`, coded ones need the
 *   code. The choice is rechecked on every read and never picked silently.
 * - Writes lock the cart row (customer carts: the customer row first, so the
 *   single active cart is created once).
 */

/** Technical limit on distinct lines (ADR-0031 §3). */
export const MAX_CART_LINES = 50;

/** Unknown discount codes per IP (ADR-0032): 20 per 15 minutes. */
export const DISCOUNT_CODE_IP_LIMIT: RateLimitPolicy = {
  limit: 20,
  windowMs: 15 * MS_PER_MINUTE,
  blockMs: 15 * MS_PER_MINUTE,
};

/** New guest carts per IP (ADR-0031 §3): 30 per hour. */
export const GUEST_CART_CREATE_IP_LIMIT: RateLimitPolicy = {
  limit: 30,
  windowMs: MS_PER_HOUR,
  blockMs: MS_PER_HOUR,
};

export type CartOwner =
  | { kind: "customer"; customerId: string }
  /** `token` is null when the request carried none (or a malformed one). */
  | { kind: "guest"; token: string | null };

export type CartItemStatus = "AVAILABLE" | "INSUFFICIENT_STOCK" | "UNAVAILABLE";

export interface CartItemView {
  id: string;
  productId: string;
  variantId: string;
  slug: string;
  sku: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  /** Current selling price; null when the item is unavailable. */
  unitPrice: number | null;
  lastSeenUnitPrice: number;
  priceChanged: boolean;
  lineTotal: number | null;
  status: CartItemStatus;
  /** Present when `status` is `INSUFFICIENT_STOCK`. */
  availableQuantity?: number;
}

export interface CartView {
  /** Null for a guest without a cart yet. */
  id: string | null;
  items: CartItemView[];
  itemCount: number;
  /** Sum of the lines that are not unavailable, at current prices. */
  subtotal: number;
  currency: string;
  /** The chosen discount, when it applies (Q138). */
  discount: AppliedDiscountView | null;
  /** The chosen discount no longer applies; it is not counted. */
  discountProblem: { discountId: string; code: string | null; reason: DiscountProblem } | null;
  discountTotal: number;
  /** `subtotal - discountTotal`, before shipping. */
  total: number;
  /** Codeless offers that apply to this cart now; the shopper may choose one. */
  availableDiscounts: AvailableDiscountView[];
  /** A price changed, a line cannot be bought as is (Q37) or the discount was dropped. */
  requiresReview: boolean;
  /** Returned once, by the write that created a guest cart. */
  guestCartToken?: string;
}

export interface AppliedDiscountView {
  id: string;
  code: string | null;
  name: string;
  percentage: number;
  amount: number;
}

export interface AvailableDiscountView extends Omit<AppliedDiscountView, "code"> {
  maxDiscountAmount: number | null;
  minimumOrderTotal: number | null;
  endsAt: string | null;
}

export interface PriceChange {
  cartItemId: string;
  previousUnitPrice: number;
  unitPrice: number;
}

const ITEM_INCLUDE = {
  variant: {
    include: {
      inventoryBalance: true,
      product: {
        include: {
          media: { where: { isMain: true, removedAt: null } },
          categories: { select: { categoryId: true } },
        },
      },
    },
  },
} as const;

type ItemRow = Prisma.CartItemGetPayload<{ include: typeof ITEM_INCLUDE }>;
type VariantRow = ItemRow["variant"];

const EMPTY_CART: Omit<CartView, "guestCartToken"> = {
  id: null,
  items: [],
  itemCount: 0,
  subtotal: 0,
  currency: "EGP",
  discount: null,
  discountProblem: null,
  discountTotal: 0,
  total: 0,
  availableDiscounts: [],
  requiresReview: false,
};

function itemNotFound(): AppError {
  return new AppError("NOT_FOUND", "Cart item not found.");
}

function available(variant: VariantRow): number {
  return variant.inventoryBalance?.availableQuantity ?? 0;
}

/** The current price, or null when the variant cannot be bought now. */
function currentPrice(variant: VariantRow): bigint | null {
  if (variant.status !== "ACTIVE" || variant.product.status !== "PUBLISHED") {
    return null;
  }
  return variant.sellingPrice;
}

function outOfStock(variantId: string, availableQuantity: number): AppError {
  return new AppError(
    "OUT_OF_STOCK",
    "The requested quantity is more than the quantity available.",
    { details: { variantId, availableQuantity } },
  );
}

function toItemView(row: ItemRow, locale: SupportedLocale): CartItemView {
  const { variant } = row;
  const { product } = variant;
  const price = currentPrice(variant);
  const stock = available(variant);
  const status: CartItemStatus =
    price === null ? "UNAVAILABLE" : stock < row.quantity ? "INSUFFICIENT_STOCK" : "AVAILABLE";
  const variantName = locale === "ar" ? variant.variantNameAr : variant.variantNameEn;
  const view: CartItemView = {
    id: row.id,
    productId: product.id,
    variantId: variant.id,
    slug: product.slug,
    sku: variant.sku,
    name: localName(product, locale),
    variantName,
    imageUrl: product.media[0] ? mediaContentUrl(product.media[0].mediaAssetId) : null,
    quantity: row.quantity,
    unitPrice: price === null ? null : toJsonNumber(price),
    lastSeenUnitPrice: toJsonNumber(row.lastSeenUnitPrice),
    priceChanged: price !== null && price !== row.lastSeenUnitPrice,
    lineTotal: price === null ? null : toJsonNumber(multiply(price, row.quantity)),
    status,
  };
  if (status === "INSUFFICIENT_STOCK") {
    view.availableQuantity = stock;
  }
  return view;
}

function discountLines(rows: ItemRow[]): DiscountLine[] {
  return rows.map((row) => {
    const price = currentPrice(row.variant);
    const { product } = row.variant;
    return {
      productId: product.id,
      brandId: product.brandId,
      categoryIds: product.categories.map((c) => c.categoryId),
      lineTotal: price === null ? null : multiply(price, row.quantity),
    };
  });
}

/** Codeless discounts running now: the offers a cart may list (R36). */
function runningOffers(now: Date) {
  return {
    status: "ACTIVE" as const,
    code: null,
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  };
}

function discountName(discount: LoadedDiscount, locale: SupportedLocale): string {
  return locale === "ar" ? discount.nameAr : discount.nameEn;
}

/** Evaluates discounts against a cart's lines for its owner (null: guest). */
async function evaluateFor(
  db: Db,
  discounts: LoadedDiscount[],
  rows: ItemRow[],
  customerId: string | null,
  now: Date,
) {
  const lines = discountLines(rows);
  const usage = await discountUsageCounts(
    db,
    discounts.map((d) => d.id),
    customerId,
  );
  return discounts.map((discount) => ({
    discount,
    result: evaluateDiscount(discount.rule, lines, usage.get(discount.id)!, now),
  }));
}

export async function loadView(
  db: Db,
  cartId: string,
  locale: SupportedLocale,
  now: Date,
): Promise<CartView> {
  const [cart, rows] = await Promise.all([
    db.cart.findUniqueOrThrow({
      where: { id: cartId },
      select: { customerId: true, discountId: true },
    }),
    db.cartItem.findMany({
      where: { cartId },
      include: ITEM_INCLUDE,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const items = rows.map((row) => toItemView(row, locale));
  const subtotal = add(BigInt(0), ...items.map((item) => BigInt(item.lineTotal ?? 0)));

  const discounts = await loadDiscounts(db, {
    OR: [runningOffers(now), ...(cart.discountId ? [{ id: cart.discountId }] : [])],
  });
  const evaluated = await evaluateFor(db, discounts, rows, cart.customerId, now);
  const chosen = evaluated.find((e) => e.discount.id === cart.discountId);

  let discount: AppliedDiscountView | null = null;
  let discountProblem: CartView["discountProblem"] = null;
  if (chosen?.result.ok) {
    discount = {
      id: chosen.discount.id,
      code: chosen.discount.code,
      name: discountName(chosen.discount, locale),
      percentage: chosen.discount.value,
      amount: toJsonNumber(chosen.result.amount),
    };
  } else if (chosen) {
    discountProblem = {
      discountId: chosen.discount.id,
      code: chosen.discount.code,
      reason: chosen.result.ok ? "INACTIVE" : chosen.result.problem,
    };
  }
  const discountTotal = discount?.amount ?? 0;
  return {
    id: cartId,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: toJsonNumber(subtotal),
    currency: "EGP",
    discount,
    discountProblem,
    discountTotal,
    total: toJsonNumber(subtotal) - discountTotal,
    availableDiscounts: evaluated.flatMap(({ discount: d, result }) =>
      result.ok && d.code === null
        ? [
            {
              id: d.id,
              name: discountName(d, locale),
              percentage: d.value,
              amount: toJsonNumber(result.amount),
              maxDiscountAmount:
                d.maxDiscountAmount === null ? null : toJsonNumber(d.maxDiscountAmount),
              minimumOrderTotal:
                d.minimumOrderTotal === null ? null : toJsonNumber(d.minimumOrderTotal),
              endsAt: d.endsAt?.toISOString() ?? null,
            },
          ]
        : [],
    ),
    requiresReview:
      discountProblem !== null ||
      items.some((item) => item.priceChanged || item.status !== "AVAILABLE"),
  };
}

async function lockCart(tx: Db, cartId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM carts WHERE id = ${cartId}::uuid FOR UPDATE`;
}

/**
 * Filter for a live guest cart: active and changed within the expiry period
 * (R35). An older one is treated as gone even before the sweep marks it.
 */
export async function liveGuestCart(db: Db, token: string, now: Date) {
  const days = await readGuestCartExpiryDays(db);
  return {
    guestTokenHash: hashToken(token),
    status: "ACTIVE" as const,
    updatedAt: { gt: new Date(now.getTime() - days * MS_PER_DAY) },
  };
}

/** The owner's active cart id (locked), or null. */
async function findActiveCart(tx: Db, owner: CartOwner, now: Date): Promise<string | null> {
  if (owner.kind === "customer") {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${owner.customerId}::uuid FOR UPDATE`;
  } else if (owner.token === null) {
    return null;
  }
  const cart = await tx.cart.findFirst({
    where:
      owner.kind === "customer"
        ? { customerId: owner.customerId, status: "ACTIVE" }
        : await liveGuestCart(tx, owner.token!, now),
    select: { id: true },
  });
  if (!cart) {
    return null;
  }
  await lockCart(tx, cart.id);
  return cart.id;
}

/** A variant that can be added to a cart now: active, published, priced. */
async function findPurchasableVariant(tx: Db, variantId: string) {
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    include: ITEM_INCLUDE.variant.include,
  });
  if (!variant) {
    throw variantNotFound();
  }
  const price = currentPrice(variant);
  if (price === null) {
    throw variantNotFound();
  }
  return { variant, price };
}

async function findOwnItem(tx: Db, cartId: string | null, itemId: string) {
  const item = cartId ? await tx.cartItem.findFirst({ where: { id: itemId, cartId } }) : null;
  if (!item) {
    throw itemNotFound();
  }
  return item;
}

/** Adds `input` to a locked cart: the line rules of `addItem`. */
async function addLine(
  tx: Db,
  cartId: string,
  input: AddCartItemInput,
  locale: SupportedLocale,
  now: Date,
): Promise<CartView> {
  const { variant, price } = await findPurchasableVariant(tx, input.variantId);
  const line = await tx.cartItem.findUnique({
    where: { cartId_productVariantId: { cartId, productVariantId: variant.id } },
  });
  const quantity = (line?.quantity ?? 0) + input.quantity;
  if (quantity > available(variant)) {
    throw outOfStock(variant.id, available(variant));
  }
  if (line) {
    await tx.cartItem.update({
      where: { id: line.id },
      data: { quantity, lastSeenUnitPrice: price, updatedAt: now },
    });
  } else {
    if ((await tx.cartItem.count({ where: { cartId } })) >= MAX_CART_LINES) {
      throw conflict(`A cart can hold up to ${MAX_CART_LINES} different items.`, {
        reason: "CART_LINE_LIMIT_REACHED",
        limit: MAX_CART_LINES,
      });
    }
    await tx.cartItem.create({
      data: {
        cartId,
        productVariantId: variant.id,
        quantity,
        lastSeenUnitPrice: price,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  await tx.cart.update({ where: { id: cartId }, data: { updatedAt: now } });
  return loadView(tx, cartId, locale, now);
}

/**
 * `addItem` for a customer inside the caller's transaction (wishlist
 * move-to-cart, TASK-042): same rules, the active cart is created if needed.
 */
export async function addToCustomerCart(
  tx: Db,
  customerId: string,
  input: AddCartItemInput,
  locale: SupportedLocale,
  now: Date,
): Promise<CartView> {
  const cartId =
    (await findActiveCart(tx, { kind: "customer", customerId }, now)) ??
    (await tx.cart.create({ data: { customerId, createdAt: now, updatedAt: now } })).id;
  return addLine(tx, cartId, input, locale, now);
}

export function createCartService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function getCart(owner: CartOwner, locale: SupportedLocale): Promise<CartView> {
    const cart =
      owner.kind === "customer"
        ? await db.cart.findFirst({ where: { customerId: owner.customerId, status: "ACTIVE" } })
        : owner.token
          ? await db.cart.findFirst({ where: await liveGuestCart(db, owner.token, clock.now()) })
          : null;
    return cart ? loadView(db, cart.id, locale, clock.now()) : { ...EMPTY_CART };
  }

  /** Guards guest cart creation per IP, then counts it. */
  async function claimGuestCart(ip: string | null, now: Date): Promise<void> {
    const key = `cart:create:ip:${ip ?? "unknown"}`;
    const until = await getBlockedUntil(db, key, now);
    if (until) {
      throw new AppError("RATE_LIMITED", "Too many new carts. Try again later.", {
        details: { retryAfterSeconds: Math.ceil((until.getTime() - now.getTime()) / 1000) },
      });
    }
    await recordHit(db, key, GUEST_CART_CREATE_IP_LIMIT, now);
  }

  /**
   * Adds a variant, or more of a variant already in the cart. Creates the
   * cart on the first write; a new guest cart returns its token once.
   */
  async function addItem(
    owner: CartOwner,
    input: AddCartItemInput,
    locale: SupportedLocale,
    ip: string | null,
  ): Promise<CartView> {
    const now = clock.now();
    let guestCartToken: string | undefined;
    if (owner.kind === "guest") {
      const existing = owner.token
        ? await db.cart.findFirst({
            where: await liveGuestCart(db, owner.token, now),
            select: { id: true },
          })
        : null;
      if (!existing) {
        await claimGuestCart(ip, now);
        guestCartToken = generateToken("cart");
      }
    }

    const view = await runInTransaction(
      async (tx) => {
        let cartId = guestCartToken ? null : await findActiveCart(tx, owner, now);
        if (cartId === null && owner.kind === "guest") {
          // The guest cart was merged in the meantime: start a new one.
          guestCartToken ??= generateToken("cart");
        }
        cartId ??= (
          await tx.cart.create({
            data:
              owner.kind === "customer"
                ? { customerId: owner.customerId, createdAt: now, updatedAt: now }
                : { guestTokenHash: hashToken(guestCartToken!), createdAt: now, updatedAt: now },
            select: { id: true },
          })
        ).id;
        return addLine(tx, cartId, input, locale, now);
      },
      {},
      db,
    );
    return guestCartToken ? { ...view, guestCartToken } : view;
  }

  /**
   * Changes a line's quantity and/or switches it to another variant of the
   * same product. Lowering a quantity is always allowed; raising it, or
   * switching variant, needs the stock. Switching to a variant already in
   * the cart folds the two lines together.
   */
  async function updateItem(
    owner: CartOwner,
    itemId: string,
    input: UpdateCartItemInput,
    locale: SupportedLocale,
  ): Promise<CartView> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        const cartId = await findActiveCart(tx, owner, now);
        const line = await findOwnItem(tx, cartId, itemId);
        const quantity = input.quantity ?? line.quantity;

        if (input.variantId === undefined || input.variantId === line.productVariantId) {
          if (quantity > line.quantity) {
            const { variant } = await findPurchasableVariant(tx, line.productVariantId);
            if (quantity > available(variant)) {
              throw outOfStock(variant.id, available(variant));
            }
          }
          await tx.cartItem.update({ where: { id: line.id }, data: { quantity, updatedAt: now } });
        } else {
          const current = await tx.productVariant.findUniqueOrThrow({
            where: { id: line.productVariantId },
            select: { productId: true },
          });
          const { variant, price } = await findPurchasableVariant(tx, input.variantId);
          if (variant.productId !== current.productId) {
            throw validationError(
              "variantId",
              "other_product",
              "Choose a variant of the same product.",
            );
          }
          const other = await tx.cartItem.findUnique({
            where: { cartId_productVariantId: { cartId: cartId!, productVariantId: variant.id } },
          });
          const total = quantity + (other?.quantity ?? 0);
          if (total > available(variant)) {
            throw outOfStock(variant.id, available(variant));
          }
          if (other) {
            await tx.cartItem.delete({ where: { id: line.id } });
            await tx.cartItem.update({
              where: { id: other.id },
              data: { quantity: total, lastSeenUnitPrice: price, updatedAt: now },
            });
          } else {
            await tx.cartItem.update({
              where: { id: line.id },
              data: {
                productVariantId: variant.id,
                quantity,
                lastSeenUnitPrice: price,
                updatedAt: now,
              },
            });
          }
        }
        await tx.cart.update({ where: { id: cartId! }, data: { updatedAt: now } });
        return loadView(tx, cartId!, locale, now);
      },
      {},
      db,
    );
  }

  async function removeItem(
    owner: CartOwner,
    itemId: string,
    locale: SupportedLocale,
  ): Promise<CartView> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        const cartId = await findActiveCart(tx, owner, now);
        const line = await findOwnItem(tx, cartId, itemId);
        await tx.cartItem.delete({ where: { id: line.id } });
        await tx.cart.update({ where: { id: cartId! }, data: { updatedAt: now } });
        return loadView(tx, cartId!, locale, now);
      },
      {},
      db,
    );
  }

  /**
   * Accepts the current prices (Q37): every purchasable line's
   * `lastSeenUnitPrice` becomes its current price. Returns the lines whose
   * price changed. A chosen discount that no longer applies is removed and
   * reported in `discountRemoved` (Q38).
   */
  async function reprice(
    owner: CartOwner,
    locale: SupportedLocale,
  ): Promise<CartView & { changes: PriceChange[]; discountRemoved: CartView["discountProblem"] }> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        const cartId = await findActiveCart(tx, owner, now);
        if (!cartId) {
          return { ...EMPTY_CART, changes: [], discountRemoved: null };
        }
        const rows = await tx.cartItem.findMany({ where: { cartId }, include: ITEM_INCLUDE });
        const changes: PriceChange[] = [];
        for (const row of rows) {
          const price = currentPrice(row.variant);
          if (price !== null && price !== row.lastSeenUnitPrice) {
            await tx.cartItem.update({
              where: { id: row.id },
              data: { lastSeenUnitPrice: price, updatedAt: now },
            });
            changes.push({
              cartItemId: row.id,
              previousUnitPrice: toJsonNumber(row.lastSeenUnitPrice),
              unitPrice: toJsonNumber(price),
            });
          }
        }
        const view = await loadView(tx, cartId, locale, now);
        if (!view.discountProblem) {
          return { ...view, changes, discountRemoved: null };
        }
        await tx.cart.update({ where: { id: cartId }, data: { discountId: null, updatedAt: now } });
        return {
          ...(await loadView(tx, cartId, locale, now)),
          changes,
          discountRemoved: view.discountProblem,
        };
      },
      {},
      db,
    );
  }

  /**
   * Merges a guest cart into the customer's cart after login (R33). An item
   * in both carts gets the sum of the quantities capped at the available
   * stock; the cap never lowers the customer's own quantity. Items in one
   * cart only are kept as they are. Without a customer cart the guest cart
   * simply becomes the customer's. An unknown or already merged token
   * changes nothing, so retries are safe.
   */
  async function merge(
    customerId: string,
    guestToken: string | null,
    locale: SupportedLocale,
  ): Promise<CartView> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        const owner: CartOwner = { kind: "customer", customerId };
        const customerCartId = await findActiveCart(tx, owner, now);
        const guestCartId = guestToken
          ? await findActiveCart(tx, { kind: "guest", token: guestToken }, now)
          : null;

        if (!guestCartId) {
          return customerCartId ? loadView(tx, customerCartId, locale, now) : { ...EMPTY_CART };
        }
        if (!customerCartId) {
          await tx.cart.update({
            where: { id: guestCartId },
            data: { customerId, guestTokenHash: null, updatedAt: now },
          });
          return loadView(tx, guestCartId, locale, now);
        }

        const guestItems = await tx.cartItem.findMany({
          where: { cartId: guestCartId },
          include: ITEM_INCLUDE,
        });
        for (const item of guestItems) {
          const own = await tx.cartItem.findUnique({
            where: {
              cartId_productVariantId: {
                cartId: customerCartId,
                productVariantId: item.productVariantId,
              },
            },
          });
          if (own) {
            const capped = Math.min(own.quantity + item.quantity, available(item.variant));
            const quantity = Math.max(own.quantity, capped);
            if (quantity !== own.quantity) {
              await tx.cartItem.update({
                where: { id: own.id },
                data: { quantity, updatedAt: now },
              });
            }
          } else {
            await tx.cartItem.create({
              data: {
                cartId: customerCartId,
                productVariantId: item.productVariantId,
                quantity: item.quantity,
                lastSeenUnitPrice: item.lastSeenUnitPrice,
                createdAt: now,
                updatedAt: now,
              },
            });
          }
        }
        const guestCart = await tx.cart.update({
          where: { id: guestCartId },
          data: { status: "MERGED", updatedAt: now },
        });
        const customerCart = await tx.cart.findUniqueOrThrow({ where: { id: customerCartId } });
        await tx.cart.update({
          where: { id: customerCartId },
          // The customer's own discount choice wins; otherwise the guest's carries over.
          data: { discountId: customerCart.discountId ?? guestCart.discountId, updatedAt: now },
        });
        return loadView(tx, customerCartId, locale, now);
      },
      {},
      db,
    );
  }

  /**
   * Chooses the cart's one discount (Q125, Q138): a code, or the id of a
   * codeless offer. It must apply now, otherwise `DISCOUNT_INVALID` /
   * `DISCOUNT_EXPIRED` with the reason. A coded discount is never chosen by
   * id, and unknown codes are throttled per IP.
   */
  async function chooseDiscount(
    owner: CartOwner,
    input: ChooseCartDiscountInput,
    locale: SupportedLocale,
    ip: string | null,
  ): Promise<CartView> {
    const now = clock.now();
    const codeKey = `discount:code:ip:${ip ?? "unknown"}`;
    if ("code" in input) {
      const until = await getBlockedUntil(db, codeKey, now);
      if (until) {
        throw new AppError("RATE_LIMITED", "Too many wrong codes. Try again later.", {
          details: { retryAfterSeconds: Math.ceil((until.getTime() - now.getTime()) / 1000) },
        });
      }
    }
    const [discount] = await loadDiscounts(
      db,
      "code" in input ? { code: input.code } : { id: input.discountId, code: null },
    );
    if (!discount) {
      if ("code" in input) {
        await recordHit(db, codeKey, DISCOUNT_CODE_IP_LIMIT, now);
      }
      throw discountRefused("NOT_FOUND");
    }
    return runInTransaction(
      async (tx) => {
        const cartId = await findActiveCart(tx, owner, now);
        if (!cartId) {
          throw discountRefused("NO_ELIGIBLE_ITEMS");
        }
        const [cart, rows] = await Promise.all([
          tx.cart.findUniqueOrThrow({ where: { id: cartId }, select: { customerId: true } }),
          tx.cartItem.findMany({ where: { cartId }, include: ITEM_INCLUDE }),
        ]);
        const [{ result }] = await evaluateFor(tx, [discount], rows, cart.customerId, now);
        if (!result.ok) {
          throw discountRefused(result.problem);
        }
        await tx.cart.update({
          where: { id: cartId },
          data: { discountId: discount.id, updatedAt: now },
        });
        return loadView(tx, cartId, locale, now);
      },
      {},
      db,
    );
  }

  async function removeDiscount(owner: CartOwner, locale: SupportedLocale): Promise<CartView> {
    const now = clock.now();
    return runInTransaction(
      async (tx) => {
        const cartId = await findActiveCart(tx, owner, now);
        if (!cartId) {
          return { ...EMPTY_CART };
        }
        await tx.cart.update({ where: { id: cartId }, data: { discountId: null, updatedAt: now } });
        return loadView(tx, cartId, locale, now);
      },
      {},
      db,
    );
  }

  /**
   * Marks guest carts unchanged for the expiry period `EXPIRED` (R35).
   * Customer carts never expire. Run daily; safe to run at any time.
   */
  async function expireGuestCarts(): Promise<number> {
    const now = clock.now();
    const days = await readGuestCartExpiryDays(db);
    const { count } = await db.cart.updateMany({
      where: {
        guestTokenHash: { not: null },
        status: "ACTIVE",
        updatedAt: { lte: new Date(now.getTime() - days * MS_PER_DAY) },
      },
      data: { status: "EXPIRED", updatedAt: now },
    });
    return count;
  }

  return {
    getCart,
    addItem,
    updateItem,
    removeItem,
    reprice,
    merge,
    chooseDiscount,
    removeDiscount,
    expireGuestCarts,
  };
}

export type CartService = ReturnType<typeof createCartService>;

let defaultService: CartService | undefined;

export function getCartService(): CartService {
  defaultService ??= createCartService({ db: getDb(), clock: systemClock });
  return defaultService;
}
