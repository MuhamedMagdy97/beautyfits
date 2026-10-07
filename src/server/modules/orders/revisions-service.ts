import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import type { Logger } from "@/server/logging/logger";
import {
  AUDIT_ENTITY_TYPES,
  recordAudit,
  SYSTEM_ACTOR,
  type AuditActor,
} from "@/server/modules/audit/audit";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import { resolveAddress } from "@/server/modules/checkout/checkout-service";
import { loadDiscounts, releaseDiscountUsage } from "@/server/modules/discounts/discounts-service";
import { evaluateDiscount, isTargeted } from "@/server/modules/discounts/engine";
import { releaseForOrder, reserveForOrder } from "@/server/modules/inventory/reservations";
import { changeOrderStatus, lockOrder, orderNotFound } from "@/server/modules/orders/orders";
import {
  createOrdersService,
  type CustomerOrderView,
} from "@/server/modules/orders/orders-service";
import {
  canonicalJson,
  EDITABLE_ORDER_STATUSES,
  planLines,
  REVISION_LIFETIME_MS,
  toRevisionView,
  type RevisionView,
} from "@/server/modules/orders/revisions";
import type { ModifyOrderInput } from "@/server/modules/orders/schemas";
import { quoteShippingForArea } from "@/server/modules/shipping/shipping-service";
import {
  availableWalletCredit,
  releaseWalletReservation,
  reserveWallet,
} from "@/server/modules/wallet/wallet-service";
import { allocate, multiply, toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Order modification and re-confirmation (TASK-032; Business Spec C5, Q32,
 * R40; User Flows §9; ADR-0038).
 *
 * - A signed-in customer changes items, address or wallet use of an own
 *   order before Preparing. The backend prices the change and stores it as a
 *   revision; the order itself does not change yet.
 * - Quantity already ordered keeps its order price; extra quantity and new
 *   items take today's price. The order's discount is re-applied with the
 *   terms it had at ordering, or dropped when no longer met. Shipping is
 *   quoted again for the (new) address and total.
 * - The customer confirms the revision within 24 hours. Confirming re-prices
 *   it: any difference is `RECONFIRMATION_REQUIRED`. Otherwise one
 *   transaction swaps the stock and wallet holds, replaces the lines and
 *   amounts (the state before stays in the revision) and sends a Confirmed
 *   order back to New for another staff review.
 */

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

const VARIANT_INCLUDE = {
  inventoryBalance: { select: { availableQuantity: true } },
  product: {
    include: {
      media: { where: { isMain: true, removedAt: null } },
      categories: { select: { categoryId: true } },
    },
  },
} as const satisfies Prisma.ProductVariantInclude;

type Snapshot = Record<string, Prisma.JsonValue>;

/** The resolved request kept on the revision and re-priced at confirmation. */
interface RevisionRequest {
  items: { variantId: string; quantity: number }[];
  areaId: string;
  address: Prisma.InputJsonObject;
  walletAmount: number;
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

interface SnapshotItem {
  variantId: string;
  productId: string;
  sku: string;
  name: Prisma.InputJsonValue;
  variantName: Prisma.InputJsonValue | null;
  image: string | null;
  unitPrice: number;
  unitCostAtSale: number | null;
  quantity: number;
  discountAmount: number;
  lineTotal: number;
}

/** The new state of the order, as stored on the revision (money in piastres). */
interface Proposed {
  items: SnapshotItem[];
  subtotal: number;
  discountTotal: number;
  discount: Prisma.InputJsonObject | null;
  discountDropped: boolean;
  shippingFee: number;
  freeShipping: boolean;
  shippingCompanyId: string | null;
  shippingRule: Prisma.InputJsonObject;
  shippingAddress: Prisma.InputJsonObject;
  total: number;
  walletAmount: number;
  codAmount: number;
}

function asJson(value: object): Prisma.InputJsonObject {
  return value as unknown as Prisma.InputJsonObject;
}

/** Prices the revised order (R40). */
async function priceRevision(
  db: Db,
  order: OrderWithItems,
  request: Omit<RevisionRequest, "walletAmount"> & { walletAmount: bigint | null },
  now: Date,
): Promise<Proposed> {
  const ids = [
    ...new Set([
      ...request.items.map((i) => i.variantId),
      ...order.items.map((i) => i.productVariantId),
    ]),
  ];
  const variants = new Map(
    (
      await db.productVariant.findMany({ where: { id: { in: ids } }, include: VARIANT_INCLUDE })
    ).map((v) => [v.id, v]),
  );
  for (const item of request.items) {
    if (!variants.has(item.variantId)) {
      throw validationError("items", "variant_not_found", "Item not found.");
    }
  }
  const today = new Map(
    [...variants.values()].map((v) => [
      v.id,
      v.status === "ACTIVE" && v.product.status === "PUBLISHED" ? v.sellingPrice : null,
    ]),
  );
  const held = order.items.map((i) => ({
    variantId: i.productVariantId,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
  }));
  const planned = planLines(held, request.items, today);
  const stockChanged = (variantIds: string[]) =>
    new AppError(
      "STOCK_CHANGED",
      "One or more items are no longer available at the requested quantity.",
      { details: { items: variantIds.map((variantId) => ({ variantId })) } },
    );
  if (!planned.ok) {
    throw stockChanged(planned.unavailable);
  }
  // Stock beyond what the order already holds must be available now.
  const short = request.items
    .filter((item) => {
      const heldQty = held
        .filter((h) => h.variantId === item.variantId)
        .reduce((sum, h) => sum + h.quantity, 0);
      const extra = item.quantity - heldQty;
      return (
        extra > 0 &&
        (variants.get(item.variantId)!.inventoryBalance?.availableQuantity ?? 0) < extra
      );
    })
    .map((item) => item.variantId);
  if (short.length > 0) {
    throw stockChanged(short);
  }

  const lines = planned.lines.map((line) => {
    const variant = variants.get(line.variantId)!;
    const kept = order.items.find(
      (i) => i.productVariantId === line.variantId && i.unitPrice === line.unitPrice,
    );
    return {
      line,
      variant,
      gross: multiply(line.unitPrice, line.quantity),
      snapshot: kept
        ? {
            productId: kept.productId,
            sku: kept.skuSnapshot,
            name: kept.productNameSnapshot,
            variantName: kept.variantNameSnapshot,
            image: kept.imageSnapshot,
            unitCostAtSale: kept.unitCostAtSale,
          }
        : {
            productId: variant.productId,
            sku: variant.sku,
            name: { ar: variant.product.nameAr, en: variant.product.nameEn },
            variantName:
              variant.variantNameAr === null && variant.variantNameEn === null
                ? null
                : { ar: variant.variantNameAr, en: variant.variantNameEn },
            image: variant.product.media[0]?.mediaAssetId ?? null,
            unitCostAtSale: variant.weightedAverageCost,
          },
    };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.gross, BigInt(0));

  // The order's discount with its order-time terms (R40); its use is already counted.
  let discount: Prisma.InputJsonObject | null = null;
  let shares = lines.map(() => BigInt(0));
  let discountTotal = BigInt(0);
  const terms = order.discountSnapshot as Snapshot | null;
  if (order.appliedDiscountId && terms) {
    const [loaded] = await loadDiscounts(db, { id: order.appliedDiscountId });
    const rule = {
      ...loaded.rule,
      status: "ACTIVE" as const,
      startsAt: new Date(0),
      endsAt: null,
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
      value: terms.percentage as number,
      maxDiscountAmount:
        terms.maxDiscountAmount === null ? null : BigInt(terms.maxDiscountAmount as number),
      minimumOrderTotal:
        terms.minimumOrderTotal === null ? null : BigInt(terms.minimumOrderTotal as number),
    };
    const discountLines = lines.map((l) => ({
      productId: l.variant.productId,
      brandId: l.variant.product.brandId,
      categoryIds: l.variant.product.categories.map((c) => c.categoryId),
      lineTotal: l.gross,
    }));
    const result = evaluateDiscount(rule, discountLines, { total: 0, customer: 0 }, now);
    if (result.ok) {
      discountTotal = result.amount;
      shares = allocate(
        result.amount,
        discountLines.map((d) => (isTargeted(rule, d) ? d.lineTotal : BigInt(0))),
      );
      discount = { ...(terms as Prisma.InputJsonObject), amount: toJsonNumber(result.amount) };
    }
  }

  const afterDiscount = subtotal - discountTotal;
  const shipping = await quoteShippingForArea(db, {
    areaId: request.areaId,
    orderTotal: afterDiscount,
    now,
  });
  const total = afterDiscount + shipping.shippingFee;

  const walletAmount =
    request.walletAmount ??
    (order.walletAmountReserved < total ? order.walletAmountReserved : total);
  if (walletAmount > total) {
    throw validationError("walletAmount", "above_total", "Use at most the order total.");
  }
  if (walletAmount > BigInt(0)) {
    // The credit this order already holds counts as available to it.
    const available =
      (await availableWalletCredit(db, order.customerId!)) + order.walletAmountReserved;
    if (available < walletAmount) {
      throw new AppError("WALLET_INSUFFICIENT_FUNDS", "The wallet does not hold enough credit.", {
        details: { available: toJsonNumber(available) },
      });
    }
  }

  return {
    items: lines.map((l, i) => ({
      variantId: l.line.variantId,
      productId: l.snapshot.productId,
      sku: l.snapshot.sku,
      name: l.snapshot.name as Prisma.InputJsonValue,
      variantName: (l.snapshot.variantName ?? null) as Prisma.InputJsonValue,
      image: l.snapshot.image,
      unitPrice: toJsonNumber(l.line.unitPrice),
      unitCostAtSale:
        l.snapshot.unitCostAtSale === null ? null : toJsonNumber(l.snapshot.unitCostAtSale),
      quantity: l.line.quantity,
      discountAmount: toJsonNumber(shares[i]),
      lineTotal: toJsonNumber(l.gross - shares[i]),
    })),
    subtotal: toJsonNumber(subtotal),
    discountTotal: toJsonNumber(discountTotal),
    discount,
    discountDropped: order.appliedDiscountId !== null && discount === null,
    shippingFee: toJsonNumber(shipping.shippingFee),
    freeShipping: shipping.freeShipping,
    shippingCompanyId: shipping.rule.shippingCompanyId,
    shippingRule: {
      ruleId: shipping.rule.id,
      shippingCompanyId: shipping.rule.shippingCompanyId,
      governorateId: shipping.rule.governorateId,
      areaId: shipping.rule.areaId,
      ruleShippingFee: toJsonNumber(shipping.rule.shippingFee),
      freeShipping: shipping.freeShipping,
      freeShippingThreshold: toJsonNumber(shipping.freeShippingThreshold),
    },
    shippingAddress: request.address,
    total: toJsonNumber(total),
    walletAmount: toJsonNumber(walletAmount),
    codAmount: toJsonNumber(total - walletAmount),
  };
}

/** The order's commercial state, kept on the revision (C5: nothing silently rewritten). */
function previousSnapshot(order: OrderWithItems): Prisma.InputJsonObject {
  return asJson({
    items: order.items.map((i) => ({
      variantId: i.productVariantId,
      productId: i.productId,
      sku: i.skuSnapshot,
      name: i.productNameSnapshot as Prisma.InputJsonValue,
      variantName: (i.variantNameSnapshot ?? null) as Prisma.InputJsonValue,
      image: i.imageSnapshot,
      unitPrice: toJsonNumber(i.unitPrice),
      unitCostAtSale: i.unitCostAtSale === null ? null : toJsonNumber(i.unitCostAtSale),
      quantity: i.quantity,
      discountAmount: toJsonNumber(i.discountAmount),
      lineTotal: toJsonNumber(i.lineTotal),
    })),
    subtotal: toJsonNumber(order.subtotal),
    discountTotal: toJsonNumber(order.discountTotal),
    discount: (order.discountSnapshot ?? null) as Prisma.InputJsonValue,
    shippingFee: toJsonNumber(order.shippingFee),
    shippingCompanyId: order.shippingCompanyId,
    shippingRule: order.shippingRuleSnapshot as Prisma.InputJsonValue,
    shippingAddress: order.shippingAddressSnapshot as Prisma.InputJsonValue,
    total: toJsonNumber(order.total),
    walletAmount: toJsonNumber(order.walletAmountReserved),
    codAmount: toJsonNumber(order.codAmount),
  });
}

function notEditable(status: string): AppError {
  return new AppError("ORDER_STATE_INVALID", "This order can no longer be changed.", {
    details: { status, reason: "NOT_EDITABLE" },
  });
}

export function createRevisionsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;
  const orders = createOrdersService(deps);

  async function loadOwnOrder(tx: Db, customerId: string, orderId: string) {
    const order = await tx.order.findFirst({
      where: { id: orderId, customerId },
      include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!order) {
      throw orderNotFound();
    }
    return order;
  }

  /** `POST /orders/{orderId}/modify`: prices the change as a revision to confirm. */
  async function modify(
    customerId: string,
    orderId: string,
    input: ModifyOrderInput,
    locale: SupportedLocale,
    ctx: Ctx,
  ): Promise<RevisionView> {
    const now = clock.now();
    const actor: AuditActor = { type: "CUSTOMER", id: customerId };
    const revision = await runInTransaction(
      async (tx) => {
        await loadOwnOrder(tx, customerId, orderId); // 404 before locking
        const status = await lockOrder(tx, orderId);
        if (!EDITABLE_ORDER_STATUSES.includes(status)) {
          throw notEditable(status);
        }
        const order = await loadOwnOrder(tx, customerId, orderId);
        const current = order.shippingAddressSnapshot as Snapshot;
        const delivery =
          input.addressId || input.address
            ? await resolveAddress(tx, customerId, input)
            : {
                areaId: (current.area as Snapshot).id as string,
                address: current as Prisma.InputJsonObject,
              };
        const proposed = await priceRevision(
          tx,
          order,
          { items: input.items, ...delivery, walletAmount: input.walletAmount ?? null },
          now,
        );

        const unchanged =
          lineKeys(proposed.items) ===
            lineKeys(
              order.items.map((i) => ({
                variantId: i.productVariantId,
                unitPrice: toJsonNumber(i.unitPrice),
                quantity: i.quantity,
              })),
            ) &&
          canonicalJson(proposed.shippingAddress) ===
            canonicalJson(order.shippingAddressSnapshot) &&
          proposed.walletAmount === toJsonNumber(order.walletAmountReserved) &&
          proposed.total === toJsonNumber(order.total);
        if (unchanged) {
          throw conflict("Nothing would change in this order.", { reason: "NO_CHANGE" });
        }

        // A newer revision replaces an open one.
        await tx.orderRevision.updateMany({
          where: { orderId, status: "PENDING_CONFIRMATION", expiresAt: { lte: now } },
          data: { status: "EXPIRED" },
        });
        await tx.orderRevision.updateMany({
          where: { orderId, status: "PENDING_CONFIRMATION" },
          data: { status: "SUPERSEDED" },
        });
        const last = await tx.orderRevision.findFirst({
          where: { orderId },
          orderBy: { revisionNumber: "desc" },
          select: { revisionNumber: true },
        });
        const created = await tx.orderRevision.create({
          data: {
            orderId,
            revisionNumber: (last?.revisionNumber ?? 0) + 1,
            requestedByCustomerId: customerId,
            oldTotal: order.total,
            newTotal: BigInt(proposed.total),
            request: {
              items: input.items,
              ...delivery,
              walletAmount: proposed.walletAmount,
            } satisfies RevisionRequest as unknown as Prisma.InputJsonObject,
            previousSnapshot: previousSnapshot(order),
            proposedSnapshot: asJson(proposed),
            expiresAt: new Date(now.getTime() + REVISION_LIFETIME_MS),
            createdAt: now,
          },
        });
        await recordAudit(tx, {
          actor,
          action: "ORDER_REVISION_REQUESTED",
          entityType: AUDIT_ENTITY_TYPES.order,
          entityId: orderId,
          previous: { total: toJsonNumber(order.total) },
          next: { revisionNumber: created.revisionNumber, total: proposed.total },
          correlationId: ctx.correlationId,
          createdAt: now,
        });
        return { revision: created, status };
      },
      {},
      db,
    );
    ctx.logger.info("order revision requested", { orderId, revisionId: revision.revision.id });
    return toRevisionView(revision.revision, revision.status, locale, now);
  }

  /** `POST /orders/{orderId}/revisions/{revisionId}/confirm` (C5). */
  async function confirm(
    customerId: string,
    orderId: string,
    revisionId: string,
    locale: SupportedLocale,
    ctx: Ctx,
  ): Promise<CustomerOrderView> {
    const now = clock.now();
    const actor: AuditActor = { type: "CUSTOMER", id: customerId };
    await runInTransaction(
      async (tx) => {
        await loadOwnOrder(tx, customerId, orderId);
        const status = await lockOrder(tx, orderId);
        const revision = await tx.orderRevision.findFirst({ where: { id: revisionId, orderId } });
        if (!revision) {
          throw new AppError("NOT_FOUND", "Revision not found.");
        }
        if (revision.status !== "PENDING_CONFIRMATION") {
          throw conflict("This change is no longer open.", {
            reason: `REVISION_${revision.status}`,
          });
        }
        if (revision.expiresAt <= now) {
          throw conflict("This change has expired.", { reason: "REVISION_EXPIRED" });
        }
        if (!EDITABLE_ORDER_STATUSES.includes(status)) {
          throw notEditable(status);
        }
        const order = await loadOwnOrder(tx, customerId, orderId);
        const request = revision.request as unknown as RevisionRequest;
        const proposed = await priceRevision(
          tx,
          order,
          { ...request, walletAmount: BigInt(request.walletAmount) },
          now,
        );
        if (canonicalJson(asJson(proposed)) !== canonicalJson(revision.proposedSnapshot)) {
          throw new AppError(
            "RECONFIRMATION_REQUIRED",
            "Prices, stock or shipping changed. Review the change again.",
            { details: { reason: "REVISION_CHANGED" } },
          );
        }
        await apply(tx, order, proposed, actor, now);

        await tx.orderRevision.update({
          where: { id: revision.id },
          data: { status: "CONFIRMED", confirmedAt: now },
        });
        const codAmount = BigInt(proposed.codAmount);
        if (status === "CONFIRMED") {
          await changeOrderStatus(tx, { orderId, to: "NEW", actor, now, reason: "ORDER_REVISED" });
        } else if (status === "PENDING_CONFIRMATION" && codAmount === BigInt(0)) {
          // The wallet now covers everything: no COD to confirm (C4).
          await changeOrderStatus(tx, {
            orderId,
            to: "NEW",
            actor: SYSTEM_ACTOR,
            now,
            reason: "WALLET_COVERS_TOTAL",
          });
        }
        await recordAudit(tx, {
          actor,
          action: "ORDER_REVISED",
          entityType: AUDIT_ENTITY_TYPES.order,
          entityId: orderId,
          previous: { total: toJsonNumber(order.total), status },
          next: { revisionNumber: revision.revisionNumber, total: proposed.total },
          correlationId: ctx.correlationId,
          createdAt: now,
        });
        await tx.outboxEvent.create({
          data: {
            eventType: "ORDER_REVISED",
            aggregateType: "ORDER",
            aggregateId: orderId,
            payload: {
              orderId,
              revisionId: revision.id,
              revisionNumber: revision.revisionNumber,
              correlationId: ctx.correlationId,
            },
            availableAt: now,
            createdAt: now,
          },
        });
      },
      {},
      db,
    );
    ctx.logger.info("order revised", { orderId, revisionId });
    return orders.getMyOrder(customerId, orderId, locale);
  }

  /** Swaps the holds and replaces the order's lines and amounts, in the caller's transaction. */
  async function apply(
    tx: Db,
    order: OrderWithItems,
    proposed: Proposed,
    actor: AuditActor,
    now: Date,
  ): Promise<void> {
    const { items } = proposed;
    const orderId = order.id;

    await releaseForOrder(tx, { orderId, actor, now, reason: "ORDER_REVISED" });
    await reserveForOrder(tx, {
      orderId,
      lines: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      actor,
      now,
    });

    const walletAmount = BigInt(proposed.walletAmount);
    await releaseWalletReservation(tx, { orderId, now });
    if (walletAmount > BigInt(0)) {
      await reserveWallet(tx, {
        customerId: order.customerId!,
        orderId,
        amount: walletAmount,
        now,
      });
    }

    const { discount } = proposed;
    if (order.appliedDiscountId) {
      if (discount) {
        await tx.discountUsage.updateMany({
          where: { orderId, releasedAt: null },
          data: { discountAmount: BigInt(proposed.discountTotal) },
        });
      } else {
        await releaseDiscountUsage(tx, orderId, now);
      }
    }

    // Allowed only inside this transaction (trigger `orders_immutable`, ADR-0038).
    await tx.$queryRaw`SELECT set_config('beautyfits.order_revision', 'on', true)`;
    await tx.orderItem.deleteMany({ where: { orderId } });
    await tx.orderItem.createMany({
      data: items.map((i) => ({
        orderId,
        productId: i.productId,
        productVariantId: i.variantId,
        skuSnapshot: i.sku,
        productNameSnapshot: i.name,
        variantNameSnapshot: i.variantName ?? undefined,
        imageSnapshot: i.image,
        unitPrice: BigInt(i.unitPrice),
        unitCostAtSale: i.unitCostAtSale === null ? null : BigInt(i.unitCostAtSale),
        quantity: i.quantity,
        discountAmount: BigInt(i.discountAmount),
        lineTotal: BigInt(i.lineTotal),
        createdAt: now,
      })),
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal: BigInt(proposed.subtotal),
        discountTotal: BigInt(proposed.discountTotal),
        shippingFee: BigInt(proposed.shippingFee),
        total: BigInt(proposed.total),
        walletAmountReserved: walletAmount,
        codAmount: BigInt(proposed.codAmount),
        ...(discount
          ? { discountSnapshot: discount }
          : { appliedDiscountId: null, discountSnapshot: Prisma.DbNull }),
        shippingCompanyId: proposed.shippingCompanyId,
        shippingRuleSnapshot: proposed.shippingRule,
        shippingAddressSnapshot: proposed.shippingAddress,
        updatedAt: now,
      },
    });
    await tx.$queryRaw`SELECT set_config('beautyfits.order_revision', 'off', true)`;
  }

  return { modify, confirm };
}

/** The lines as a comparable string, whatever their order. */
function lineKeys(lines: readonly { variantId: string; unitPrice: number; quantity: number }[]) {
  return lines
    .map((l) => `${l.variantId}:${l.unitPrice}:${l.quantity}`)
    .sort()
    .join(",");
}

export type RevisionsService = ReturnType<typeof createRevisionsService>;

let defaultService: RevisionsService | undefined;

export function getRevisionsService(): RevisionsService {
  defaultService ??= createRevisionsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
