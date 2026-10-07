import { createHash } from "node:crypto";
import type { OrderStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import type { Logger } from "@/server/logging/logger";
import { SYSTEM_ACTOR, type AuditActor } from "@/server/modules/audit/audit";
import { hashToken } from "@/server/modules/auth/tokens";
import {
  liveGuestCart,
  loadView,
  type CartItemView,
  type CartOwner,
  type CartView,
} from "@/server/modules/cart/cart-service";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import type { CheckoutInput, CheckoutQuoteInput } from "@/server/modules/checkout/schemas";
import {
  discountRefused,
  loadDiscounts,
  recordDiscountUsage,
} from "@/server/modules/discounts/discounts-service";
import { isTargeted } from "@/server/modules/discounts/engine";
import { reserveForOrder } from "@/server/modules/inventory/reservations";
import { findUsableArea } from "@/server/modules/locations/locations-service";
import { loadOrderSummary, type OrderSummaryView } from "@/server/modules/orders/orders-service";
import { readCodSettings } from "@/server/modules/settings/settings";
import { quoteShippingForArea } from "@/server/modules/shipping/shipping-service";
import { availableWalletCredit, reserveWallet } from "@/server/modules/wallet/wallet-service";
import { allocate, multiply, toJsonNumber } from "@/server/money/money";
import { getBlockedUntil, recordHit, type RateLimitPolicy } from "@/server/rate-limit/rate-limit";
import { MS_PER_HOUR, systemClock, type Clock } from "@/server/time/time";

/**
 * Checkout (TASK-029, Business Spec Q28, Q37–Q40, Q46, C1, C4, R36, R37;
 * User Flows §6.2–§6.4; Architecture §9; ADR-0035).
 *
 * - Everything is recomputed from the database: current prices, stock,
 *   the chosen discount, the shipping fee for the address and the wallet.
 *   A cart that needs review (price change, unavailable line, dropped
 *   discount) is refused with the matching code; the client never sends a
 *   price, only the `expectedTotal` it showed, which must match.
 * - One transaction creates the order, its items (with snapshots and the
 *   discount allocated per line) and first status, reserves stock, counts
 *   the discount use, holds the wallet credit, converts the cart, records
 *   the checkout attempt and writes the `ORDER_CREATED` outbox event.
 *   Messages go out after commit, from the outbox.
 * - Idempotent per shopper and `Idempotency-Key`: the same key and body
 *   return the same order; another body is `IDEMPOTENCY_CONFLICT`. The
 *   shopper's row (customer, or guest cart) is locked first, so concurrent
 *   retries wait and then replay.
 * - Wallet credit covering the whole total needs no COD confirmation: the
 *   order starts `NEW` (C4); otherwise `PENDING_CONFIRMATION`, with its
 *   confirmation deadline fixed from the timeout setting (R39) and, on the
 *   WhatsApp channel, a `COD_CONFIRMATION_REQUESTED` outbox event (TASK-031).
 */

/** Checkout requests per IP (ADR-0035): 20 per hour. */
export const CHECKOUT_IP_LIMIT: RateLimitPolicy = {
  limit: 20,
  windowMs: MS_PER_HOUR,
  blockMs: MS_PER_HOUR,
};

const LINE_INCLUDE = {
  variant: {
    include: {
      product: {
        include: {
          media: { where: { isMain: true, removedAt: null } },
          categories: { select: { categoryId: true } },
        },
      },
    },
  },
} as const;

type LineRow = Prisma.CartItemGetPayload<{ include: typeof LINE_INCLUDE }>;

interface PricedLine {
  row: LineRow;
  unitPrice: bigint;
  discountAmount: bigint;
  lineTotal: bigint;
}

interface Contact {
  fullName: string;
  phone: string;
  email: string | null;
}

interface Priced {
  view: CartView;
  lines: PricedLine[];
  subtotal: bigint;
  discount: { id: string; snapshot: Prisma.InputJsonObject; amount: bigint } | null;
  shipping: Awaited<ReturnType<typeof quoteShippingForArea>>;
  total: bigint;
  walletAmount: bigint;
  codAmount: bigint;
  contact: Contact;
  address: Prisma.InputJsonObject;
}

export interface CheckoutQuoteView {
  items: CartItemView[];
  subtotal: number;
  discount: CartView["discount"];
  discountTotal: number;
  shippingFee: number;
  freeShipping: boolean;
  freeShippingThreshold: number;
  total: number;
  walletAmount: number;
  codAmount: number;
  codConfirmationRequired: boolean;
  currency: "EGP";
}

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

function cartEmpty(): AppError {
  return conflict("Your cart is empty.", { reason: "CART_EMPTY" });
}

/** Contact and delivery address, checked; the address as its order snapshot. */
async function resolveDelivery(
  db: Db,
  customerId: string | null,
  input: CheckoutQuoteInput,
): Promise<{ contact: Contact; areaId: string; address: Prisma.InputJsonObject }> {
  let contact: Contact;
  if (customerId) {
    const customer = await db.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { account: { select: { email: true } } },
    });
    contact = {
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.account?.email ?? null,
    };
  } else {
    if (!input.contact) {
      throw validationError("contact", "required", "Enter your name and phone number.");
    }
    if (input.walletAmount > BigInt(0)) {
      throw validationError("walletAmount", "sign_in_required", "Sign in to use your wallet.");
    }
    if (input.addressId) {
      throw validationError("addressId", "sign_in_required", "Sign in to use a saved address.");
    }
    contact = { ...input.contact, email: input.contact.email ?? null };
  }
  return { contact, ...(await resolveAddress(db, customerId, input)) };
}

/**
 * A saved address of the customer or an inline one, checked, as its order
 * snapshot (also used by order revisions, TASK-032).
 */
export async function resolveAddress(
  db: Db,
  customerId: string | null,
  input: Pick<CheckoutQuoteInput, "addressId" | "address">,
): Promise<{ areaId: string; address: Prisma.InputJsonObject }> {
  let fields: NonNullable<CheckoutQuoteInput["address"]>;
  let sourceAddressId: string | null = null;
  if (input.addressId) {
    const saved = await db.customerAddress.findFirst({
      where: { id: input.addressId, customerId: customerId! },
    });
    if (!saved) {
      throw new AppError("NOT_FOUND", "Address not found.");
    }
    fields = saved;
    sourceAddressId = saved.id;
  } else {
    fields = input.address!;
  }
  const area = await findUsableArea(db, fields.areaId);
  return {
    areaId: area.id,
    address: {
      sourceAddressId,
      recipientName: fields.recipientName,
      phone: fields.phone,
      governorate: {
        id: area.governorate.id,
        code: area.governorate.code,
        nameAr: area.governorate.nameAr,
        nameEn: area.governorate.nameEn,
      },
      area: { id: area.id, nameAr: area.nameAr, nameEn: area.nameEn },
      city: fields.city ?? null,
      street: fields.street,
      building: fields.building ?? null,
      floor: fields.floor ?? null,
      apartment: fields.apartment ?? null,
      landmark: fields.landmark ?? null,
      notes: fields.notes ?? null,
    },
  };
}

/** The cart must be orderable as shown (Q37, Q38); otherwise the matching error. */
function assertOrderable(view: CartView): void {
  if (view.items.length === 0) {
    throw cartEmpty();
  }
  const blocked = view.items.filter((item) => item.status !== "AVAILABLE");
  if (blocked.length > 0) {
    throw new AppError(
      "STOCK_CHANGED",
      "One or more items are no longer available at the requested quantity.",
      {
        details: {
          items: blocked.map((item) => ({
            cartItemId: item.id,
            variantId: item.variantId,
            status: item.status,
          })),
        },
      },
    );
  }
  const changed = view.items.filter((item) => item.priceChanged);
  if (changed.length > 0) {
    throw new AppError("PRICE_CHANGED", "Some prices changed. Review your cart.", {
      details: {
        items: changed.map((item) => ({
          cartItemId: item.id,
          previousUnitPrice: item.lastSeenUnitPrice,
          unitPrice: item.unitPrice,
        })),
      },
    });
  }
  if (view.discountProblem) {
    throw discountRefused(view.discountProblem.reason);
  }
}

/** The authoritative checkout calculation (User Flows §6.2), read-only. */
async function priceCheckout(
  db: Db,
  input: {
    cartId: string;
    customerId: string | null;
    quote: CheckoutQuoteInput;
    locale: SupportedLocale;
    now: Date;
    logger?: Logger;
  },
): Promise<Priced> {
  const delivery = await resolveDelivery(db, input.customerId, input.quote);
  const view = await loadView(db, input.cartId, input.locale, input.now);
  assertOrderable(view);

  const rows = await db.cartItem.findMany({
    where: { cartId: input.cartId },
    include: LINE_INCLUDE,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const totals = rows.map((row) => multiply(row.variant.sellingPrice!, row.quantity));
  const subtotal = totals.reduce((sum, t) => sum + t, BigInt(0));

  let discount: Priced["discount"] = null;
  let shares = rows.map(() => BigInt(0));
  if (view.discount) {
    const [loaded] = await loadDiscounts(db, { id: view.discount.id });
    const amount = BigInt(view.discount.amount);
    // The discount is spread over the lines it targets (ADR-0035 §4).
    shares = allocate(
      amount,
      rows.map((row, i) =>
        isTargeted(loaded.rule, {
          productId: row.variant.productId,
          brandId: row.variant.product.brandId,
          categoryIds: row.variant.product.categories.map((c) => c.categoryId),
          lineTotal: totals[i],
        })
          ? totals[i]
          : BigInt(0),
      ),
    );
    discount = {
      id: loaded.id,
      amount,
      snapshot: {
        id: loaded.id,
        code: loaded.code,
        nameAr: loaded.nameAr,
        nameEn: loaded.nameEn,
        percentage: loaded.value,
        maxDiscountAmount:
          loaded.maxDiscountAmount === null ? null : toJsonNumber(loaded.maxDiscountAmount),
        minimumOrderTotal:
          loaded.minimumOrderTotal === null ? null : toJsonNumber(loaded.minimumOrderTotal),
        amount: toJsonNumber(amount),
      },
    };
  }

  const afterDiscount = subtotal - (discount?.amount ?? BigInt(0));
  const shipping = await quoteShippingForArea(db, {
    areaId: delivery.areaId,
    orderTotal: afterDiscount,
    now: input.now,
    logger: input.logger,
  });
  const total = afterDiscount + shipping.shippingFee;

  const walletAmount = input.quote.walletAmount;
  if (walletAmount > total) {
    throw validationError("walletAmount", "above_total", "Use at most the order total.");
  }
  if (walletAmount > BigInt(0)) {
    const available = await availableWalletCredit(db, input.customerId!);
    if (available < walletAmount) {
      throw new AppError("WALLET_INSUFFICIENT_FUNDS", "The wallet does not hold enough credit.", {
        details: { available: toJsonNumber(available) },
      });
    }
  }

  return {
    view,
    lines: rows.map((row, i) => ({
      row,
      unitPrice: row.variant.sellingPrice!,
      discountAmount: shares[i],
      lineTotal: totals[i] - shares[i],
    })),
    subtotal,
    discount,
    shipping,
    total,
    walletAmount,
    codAmount: total - walletAmount,
    contact: delivery.contact,
    address: delivery.address,
  };
}

function fingerprint(input: CheckoutInput): string {
  return createHash("sha256")
    .update(JSON.stringify(input, (_, v) => (typeof v === "bigint" ? `${v}` : v)))
    .digest("hex");
}

export function createCheckoutService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function activeCartId(tx: Db, owner: CartOwner, now: Date): Promise<string | null> {
    const cart =
      owner.kind === "customer"
        ? await tx.cart.findFirst({
            where: { customerId: owner.customerId, status: "ACTIVE" },
            select: { id: true },
          })
        : owner.token
          ? await tx.cart.findFirst({
              where: await liveGuestCart(tx, owner.token, now),
              select: { id: true },
            })
          : null;
    return cart?.id ?? null;
  }

  /** `POST /checkout/validate`: the totals the order would have now; nothing is written. */
  async function quote(
    owner: CartOwner,
    input: CheckoutQuoteInput,
    locale: SupportedLocale,
    logger?: Logger,
  ): Promise<CheckoutQuoteView> {
    const now = clock.now();
    const cartId = await activeCartId(db, owner, now);
    if (!cartId) {
      throw cartEmpty();
    }
    const customerId = owner.kind === "customer" ? owner.customerId : null;
    const priced = await priceCheckout(db, {
      cartId,
      customerId,
      quote: input,
      locale,
      now,
      logger,
    });
    return {
      items: priced.view.items,
      subtotal: toJsonNumber(priced.subtotal),
      discount: priced.view.discount,
      discountTotal: priced.view.discountTotal,
      shippingFee: toJsonNumber(priced.shipping.shippingFee),
      freeShipping: priced.shipping.freeShipping,
      freeShippingThreshold: toJsonNumber(priced.shipping.freeShippingThreshold),
      total: toJsonNumber(priced.total),
      walletAmount: toJsonNumber(priced.walletAmount),
      codAmount: toJsonNumber(priced.codAmount),
      codConfirmationRequired: priced.codAmount > BigInt(0),
      currency: "EGP",
    };
  }

  /** `POST /checkout`: places the COD order (Q39, Q40). */
  async function placeOrder(
    owner: CartOwner,
    input: CheckoutInput,
    idempotencyKey: string,
    locale: SupportedLocale,
    ip: string | null,
    ctx: Ctx,
  ): Promise<OrderSummaryView> {
    const now = clock.now();
    const ipKey = `checkout:ip:${ip ?? "unknown"}`;
    const until = await getBlockedUntil(db, ipKey, now);
    if (until) {
      throw new AppError("RATE_LIMITED", "Too many checkout attempts. Try again later.", {
        details: { retryAfterSeconds: Math.ceil((until.getTime() - now.getTime()) / 1000) },
      });
    }
    await recordHit(db, ipKey, CHECKOUT_IP_LIMIT, now);

    if (owner.kind === "guest" && !owner.token) {
      throw cartEmpty();
    }
    const customerId = owner.kind === "customer" ? owner.customerId : null;
    const guestHash = owner.kind === "guest" ? hashToken(owner.token!) : null;
    const scope = customerId ? `CUSTOMER:${customerId}` : `GUEST_CART:${guestHash}`;
    const print = fingerprint(input);
    const actor: AuditActor = customerId ? { type: "CUSTOMER", id: customerId } : SYSTEM_ACTOR;

    const result = await runInTransaction(
      async (tx) => {
        // Serializes this shopper's checkouts (and retries of one key).
        if (customerId) {
          await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT id FROM carts
            WHERE guest_token_hash = ${guestHash} FOR UPDATE`;
        }
        const previous = await tx.checkoutAttempt.findUnique({
          where: { scope_idempotencyKey: { scope, idempotencyKey } },
        });
        if (previous) {
          if (previous.requestFingerprint !== print) {
            throw new AppError(
              "IDEMPOTENCY_CONFLICT",
              "This Idempotency-Key was used for a different request.",
            );
          }
          return { orderId: previous.resultOrderId!, replayed: true };
        }

        const cartId = await activeCartId(tx, owner, now);
        if (!cartId) {
          throw cartEmpty();
        }
        await tx.$queryRaw`SELECT id FROM carts WHERE id = ${cartId}::uuid FOR UPDATE`;
        const priced = await priceCheckout(tx, {
          cartId,
          customerId,
          quote: input,
          locale,
          now,
          logger: ctx.logger,
        });
        if (priced.total !== input.expectedTotal) {
          throw new AppError("PRICE_CHANGED", "The order total changed. Review it again.", {
            details: { reason: "TOTAL_CHANGED", total: toJsonNumber(priced.total) },
          });
        }

        const [{ seq }] = await tx.$queryRaw<{ seq: bigint }[]>`
          SELECT nextval('order_number_seq') AS seq`;
        const status: OrderStatus = priced.codAmount === BigInt(0) ? "NEW" : "PENDING_CONFIRMATION";
        const cod = status === "PENDING_CONFIRMATION" ? await readCodSettings(tx) : null;
        const order = await tx.order.create({
          data: {
            orderNumber: `BF-${seq}`,
            codConfirmationDeadlineAt: cod
              ? new Date(now.getTime() + cod.timeoutHours * MS_PER_HOUR)
              : null,
            customerId,
            guestEmail: customerId ? null : priced.contact.email,
            guestPhone: customerId ? null : priced.contact.phone,
            status,
            locale,
            subtotal: priced.subtotal,
            discountTotal: priced.discount?.amount ?? BigInt(0),
            shippingFee: priced.shipping.shippingFee,
            total: priced.total,
            walletAmountReserved: priced.walletAmount,
            codAmount: priced.codAmount,
            appliedDiscountId: priced.discount?.id ?? null,
            discountSnapshot: priced.discount?.snapshot,
            shippingCompanyId: priced.shipping.rule.shippingCompanyId,
            shippingRuleSnapshot: {
              ruleId: priced.shipping.rule.id,
              shippingCompanyId: priced.shipping.rule.shippingCompanyId,
              governorateId: priced.shipping.rule.governorateId,
              areaId: priced.shipping.rule.areaId,
              ruleShippingFee: toJsonNumber(priced.shipping.rule.shippingFee),
              freeShipping: priced.shipping.freeShipping,
              freeShippingThreshold: toJsonNumber(priced.shipping.freeShippingThreshold),
            },
            shippingAddressSnapshot: priced.address,
            customerSnapshot: { customerId, ...priced.contact },
            createdAt: now,
            updatedAt: now,
            items: {
              create: priced.lines.map(({ row, unitPrice, discountAmount, lineTotal }) => ({
                productId: row.variant.productId,
                productVariantId: row.productVariantId,
                skuSnapshot: row.variant.sku,
                productNameSnapshot: {
                  ar: row.variant.product.nameAr,
                  en: row.variant.product.nameEn,
                },
                variantNameSnapshot:
                  row.variant.variantNameAr === null && row.variant.variantNameEn === null
                    ? undefined
                    : { ar: row.variant.variantNameAr, en: row.variant.variantNameEn },
                imageSnapshot: row.variant.product.media[0]?.mediaAssetId ?? null,
                unitPrice,
                unitCostAtSale: row.variant.weightedAverageCost,
                quantity: row.quantity,
                discountAmount,
                lineTotal,
                createdAt: now,
              })),
            },
            statusHistory: {
              create: {
                toStatus: status,
                changedByType: actor.type,
                changedById: actor.id ?? null,
                reason: status === "NEW" ? "WALLET_COVERS_TOTAL" : null,
                createdAt: now,
              },
            },
          },
        });

        await reserveForOrder(tx, {
          orderId: order.id,
          lines: priced.lines.map(({ row }) => ({
            variantId: row.productVariantId,
            quantity: row.quantity,
          })),
          actor,
          now,
        });
        if (priced.discount) {
          await recordDiscountUsage(tx, {
            discountId: priced.discount.id,
            orderId: order.id,
            customerId,
            discountAmount: priced.discount.amount,
            now,
          });
        }
        if (priced.walletAmount > BigInt(0)) {
          await reserveWallet(tx, {
            customerId: customerId!,
            orderId: order.id,
            amount: priced.walletAmount,
            now,
          });
        }
        await tx.cart.update({
          where: { id: cartId },
          data: { status: "CONVERTED", updatedAt: now },
        });
        await tx.checkoutAttempt.create({
          data: {
            scope,
            idempotencyKey,
            cartId,
            resultOrderId: order.id,
            status: "SUCCEEDED",
            requestFingerprint: print,
            createdAt: now,
            completedAt: now,
          },
        });
        await tx.outboxEvent.create({
          data: {
            eventType: "ORDER_CREATED",
            aggregateType: "ORDER",
            aggregateId: order.id,
            payload: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              status,
              codAmount: toJsonNumber(priced.codAmount),
              correlationId: ctx.correlationId,
            },
            availableAt: now,
            createdAt: now,
          },
        });
        if (cod?.channel === "WHATSAPP") {
          await tx.outboxEvent.create({
            data: {
              eventType: "COD_CONFIRMATION_REQUESTED",
              aggregateType: "ORDER",
              aggregateId: order.id,
              payload: { orderId: order.id, correlationId: ctx.correlationId },
              availableAt: now,
              createdAt: now,
            },
          });
        }
        return { orderId: order.id, replayed: false };
      },
      {},
      db,
    );

    if (!result.replayed) {
      ctx.logger.info("order placed", { orderId: result.orderId, customerId });
    }
    return loadOrderSummary(db, result.orderId, locale);
  }

  return { quote, placeOrder };
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;

let defaultService: CheckoutService | undefined;

export function getCheckoutService(): CheckoutService {
  defaultService ??= createCheckoutService({ db: getDb(), clock: systemClock });
  return defaultService;
}
