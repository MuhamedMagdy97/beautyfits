import type { OrderStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import type { Pagination } from "@/server/http/response";
import type { SupportedLocale } from "@/server/http/locale";
import type { Logger } from "@/server/logging/logger";
import {
  AUDIT_ENTITY_TYPES,
  employeeActor,
  recordAudit,
  type AuditAction,
} from "@/server/modules/audit/audit";
import { mediaContentUrl } from "@/server/modules/media/uploads-service";
import { changeOrderStatus, orderNotFound } from "@/server/modules/orders/orders";
import type { ListMyOrdersQuery, ListOrdersQuery } from "@/server/modules/orders/schemas";
import { permissionDenied, type PermissionSet } from "@/server/modules/rbac/authorization";
import { toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Orders (TASK-030, Business Spec Q46, Q80–Q84, Q184, Q185, R2, R4, R19;
 * User Flows §8; API §15; ADR-0036).
 *
 * - Orders are read from their snapshots, never rebuilt from current
 *   products or profiles (Q46, Q184). The database rejects changes to the
 *   snapshot and to order items (trigger `orders_immutable`).
 * - Customers see only their own orders; guests have no online order access (R16).
 * - Staff need `ORDERS_VIEW`; contact data (phone, email, street address)
 *   needs `VIEW_CUSTOMER_CONTACT` and costs `VIEW_COST_PRICE` (Q74, Q80).
 * - Staff move orders New → Confirmed → Preparing → Ready for Shipment with
 *   their permission (Q82, Q83, R4); no approval in v1 (R19). Each change
 *   writes status history and an audit entry; confirming also writes the
 *   `ORDER_CONFIRMED` outbox event.
 */

const ITEMS = {
  items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof ITEMS }>;

const DETAIL = {
  ...ITEMS,
  statusHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  shippingCompany: { select: { id: true, code: true, name: true } },
} as const satisfies Prisma.OrderInclude;

type OrderDetail = Prisma.OrderGetPayload<{ include: typeof DETAIL }>;

interface Ctx {
  logger: Logger;
  correlationId: string | null;
}

export interface OrderActor {
  employeeId: string;
  permissions: PermissionSet;
}

/** The order as returned by `POST /checkout` (API "TASK-029 Amendments"). */
export interface OrderSummaryView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
  walletAmount: number;
  codAmount: number;
  codConfirmationRequired: boolean;
  items: {
    variantId: string;
    sku: string;
    name: string;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    lineTotal: number;
  }[];
  createdAt: string;
}

/** `GET /orders/{orderId}`. */
export interface CustomerOrderView extends OrderSummaryView {
  discount: { code: string | null; name: string | null } | null;
  shippingAddress: Prisma.JsonValue;
  statusHistory: { status: OrderStatus; at: string }[];
}

/** One row of `GET /me/orders` and `GET /admin/orders`. */
export interface OrderListItemView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  total: number;
  codAmount: number;
  itemCount: number;
  createdAt: string;
  /** Admin list only; `phone` only with `VIEW_CUSTOMER_CONTACT`. */
  customer?: { customerId: string | null; fullName: string; phone?: string };
}

type Snapshot = Record<string, Prisma.JsonValue>;

/** `GET /admin/orders/{orderId}`. */
export interface AdminOrderView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: string;
  currency: string;
  locale: string;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
  walletAmountReserved: number;
  walletAmountCaptured: number;
  codAmount: number;
  codConfirmationRequired: boolean;
  taxIncluded: boolean;
  taxAmount: number | null;
  taxRate: string | null;
  /** `phone` and `email` only with `VIEW_CUSTOMER_CONTACT`. */
  customer: { customerId: string | null; fullName: string; phone?: string; email?: string | null };
  /** Without `VIEW_CUSTOMER_CONTACT`: governorate and area only. */
  shippingAddress: Snapshot;
  discount: Prisma.JsonValue;
  shipping: {
    company: { id: string; code: string; name: string } | null;
    rule: Prisma.JsonValue;
  };
  items: {
    id: string;
    productId: string;
    variantId: string;
    sku: string;
    name: Prisma.JsonValue;
    variantName: Prisma.JsonValue;
    image: { mediaAssetId: string; url: string } | null;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    lineTotal: number;
    /** Only with `VIEW_COST_PRICE`. */
    unitCostAtSale?: number | null;
  }[];
  statusHistory: {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    changedByType: string;
    changedById: string | null;
    reason: string | null;
    createdAt: string;
  }[];
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function localized(value: Prisma.JsonValue | null, locale: SupportedLocale): string | null {
  return value === null ? null : ((value as Record<string, string | null>)[locale] ?? null);
}

function toSummary(order: OrderWithItems, locale: SupportedLocale): OrderSummaryView {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    subtotal: toJsonNumber(order.subtotal),
    discountTotal: toJsonNumber(order.discountTotal),
    shippingFee: toJsonNumber(order.shippingFee),
    total: toJsonNumber(order.total),
    walletAmount: toJsonNumber(order.walletAmountReserved),
    codAmount: toJsonNumber(order.codAmount),
    codConfirmationRequired: order.codAmount > BigInt(0),
    items: order.items.map((item) => ({
      variantId: item.productVariantId,
      sku: item.skuSnapshot,
      name: localized(item.productNameSnapshot, locale) ?? "",
      variantName: localized(item.variantNameSnapshot, locale),
      quantity: item.quantity,
      unitPrice: toJsonNumber(item.unitPrice),
      discountAmount: toJsonNumber(item.discountAmount),
      lineTotal: toJsonNumber(item.lineTotal),
    })),
    createdAt: order.createdAt.toISOString(),
  };
}

/** The checkout response of an order (also used for idempotent replays). */
export async function loadOrderSummary(
  db: Db,
  orderId: string,
  locale: SupportedLocale,
): Promise<OrderSummaryView> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: ITEMS });
  return toSummary(order, locale);
}

function toCustomerView(order: OrderDetail, locale: SupportedLocale): CustomerOrderView {
  const discount = order.discountSnapshot as Snapshot | null;
  return {
    ...toSummary(order, locale),
    discount: discount && {
      code: (discount.code as string | null) ?? null,
      name: ((locale === "ar" ? discount.nameAr : discount.nameEn) as string | null) ?? null,
    },
    shippingAddress: order.shippingAddressSnapshot,
    statusHistory: order.statusHistory.map((h) => ({
      status: h.toStatus,
      at: h.createdAt.toISOString(),
    })),
  };
}

function toAdminView(order: OrderDetail, permissions: PermissionSet): AdminOrderView {
  const contact = permissions.has("VIEW_CUSTOMER_CONTACT");
  const costs = permissions.has("VIEW_COST_PRICE");
  const person = order.customerSnapshot as Snapshot;
  const address = order.shippingAddressSnapshot as Snapshot;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    locale: order.locale,
    subtotal: toJsonNumber(order.subtotal),
    discountTotal: toJsonNumber(order.discountTotal),
    shippingFee: toJsonNumber(order.shippingFee),
    total: toJsonNumber(order.total),
    walletAmountReserved: toJsonNumber(order.walletAmountReserved),
    walletAmountCaptured: toJsonNumber(order.walletAmountCaptured),
    codAmount: toJsonNumber(order.codAmount),
    codConfirmationRequired: order.codAmount > BigInt(0),
    taxIncluded: order.taxIncluded,
    taxAmount: order.taxAmount === null ? null : toJsonNumber(order.taxAmount),
    taxRate: order.taxRate === null ? null : order.taxRate.toString(),
    customer: {
      customerId: order.customerId,
      fullName: person.fullName as string,
      ...(contact ? { phone: person.phone as string, email: person.email as string | null } : {}),
    },
    shippingAddress: contact ? address : { governorate: address.governorate, area: address.area },
    discount: order.discountSnapshot,
    shipping: { company: order.shippingCompany, rule: order.shippingRuleSnapshot },
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.productVariantId,
      sku: item.skuSnapshot,
      name: item.productNameSnapshot,
      variantName: item.variantNameSnapshot,
      image: item.imageSnapshot
        ? { mediaAssetId: item.imageSnapshot, url: mediaContentUrl(item.imageSnapshot) }
        : null,
      quantity: item.quantity,
      unitPrice: toJsonNumber(item.unitPrice),
      discountAmount: toJsonNumber(item.discountAmount),
      lineTotal: toJsonNumber(item.lineTotal),
      ...(costs
        ? {
            unitCostAtSale: item.unitCostAtSale === null ? null : toJsonNumber(item.unitCostAtSale),
          }
        : {}),
    })),
    statusHistory: order.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedByType: h.changedByType,
      changedById: h.changedById,
      reason: h.reason,
      createdAt: h.createdAt.toISOString(),
    })),
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

const LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  currency: true,
  total: true,
  codAmount: true,
  createdAt: true,
  customerId: true,
  customerSnapshot: true,
  _count: { select: { items: true } },
} as const satisfies Prisma.OrderSelect;

type ListRow = Prisma.OrderGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(row: ListRow): OrderListItemView {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    currency: row.currency,
    total: toJsonNumber(row.total),
    codAmount: toJsonNumber(row.codAmount),
    itemCount: row._count.items,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Staff transitions of TASK-030 (User Flows §8.3). */
const STAFF_STEPS = {
  confirm: { to: "CONFIRMED", action: "ORDER_CONFIRMED" },
  startPreparing: { to: "PREPARING", action: "ORDER_PREPARING_STARTED" },
  markReadyForShipment: { to: "READY_FOR_SHIPMENT", action: "ORDER_READY_FOR_SHIPMENT" },
} as const satisfies Record<string, { to: OrderStatus; action: AuditAction }>;

export function createOrdersService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function page<T>(
    where: Prisma.OrderWhereInput,
    query: { page: number; pageSize: number },
    map: (row: ListRow) => T,
  ): Promise<{ items: T[]; pagination: Pagination }> {
    const [count, rows] = await Promise.all([
      db.order.count({ where }),
      db.order.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(map),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: count,
        totalPages: Math.ceil(count / query.pageSize),
      },
    };
  }

  /** `GET /me/orders`: the customer's own orders, newest first. */
  function listMyOrders(customerId: string, query: ListMyOrdersQuery) {
    return page({ customerId }, query, toListItem);
  }

  /** `GET /orders/{orderId}`: another customer's order is 404. */
  async function getMyOrder(
    customerId: string,
    orderId: string,
    locale: SupportedLocale,
  ): Promise<CustomerOrderView> {
    const order = await db.order.findFirst({ where: { id: orderId, customerId }, include: DETAIL });
    if (!order) {
      throw orderNotFound();
    }
    return toCustomerView(order, locale);
  }

  /** `GET /admin/orders`. */
  function listOrders(query: ListOrdersQuery, permissions: PermissionSet) {
    const contact = permissions.has("VIEW_CUSTOMER_CONTACT");
    if (query.phone && !contact) {
      throw permissionDenied("Searching by phone needs VIEW_CUSTOMER_CONTACT.", {
        requiredPermissions: ["VIEW_CUSTOMER_CONTACT"],
      });
    }
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search ? { orderNumber: { contains: query.search, mode: "insensitive" } } : {}),
      ...(query.phone
        ? {
            OR: [
              { guestPhone: query.phone },
              { customerSnapshot: { path: ["phone"], equals: query.phone } },
            ],
          }
        : {}),
    };
    return page(where, query, (row) => {
      const person = row.customerSnapshot as Snapshot;
      return {
        ...toListItem(row),
        customer: {
          customerId: row.customerId,
          fullName: person.fullName as string,
          ...(contact ? { phone: person.phone as string } : {}),
        },
      };
    });
  }

  /** `GET /admin/orders/{orderId}`. */
  async function getOrder(orderId: string, permissions: PermissionSet): Promise<AdminOrderView> {
    const order = await db.order.findUnique({ where: { id: orderId }, include: DETAIL });
    if (!order) {
      throw orderNotFound();
    }
    return toAdminView(order, permissions);
  }

  async function staffStep(
    step: keyof typeof STAFF_STEPS,
    actor: OrderActor,
    orderId: string,
    ctx: Ctx,
  ): Promise<AdminOrderView> {
    const { to, action } = STAFF_STEPS[step];
    const now = clock.now();
    await runInTransaction(
      async (tx) => {
        const from = await changeOrderStatus(tx, {
          orderId,
          to,
          actor: employeeActor(actor.employeeId),
          now,
          data: to === "CONFIRMED" ? { confirmedAt: now } : undefined,
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action,
          entityType: AUDIT_ENTITY_TYPES.order,
          entityId: orderId,
          previous: { status: from },
          next: { status: to },
          correlationId: ctx.correlationId,
          createdAt: now,
        });
        if (to === "CONFIRMED") {
          await tx.outboxEvent.create({
            data: {
              eventType: "ORDER_CONFIRMED",
              aggregateType: "ORDER",
              aggregateId: orderId,
              payload: { orderId, correlationId: ctx.correlationId },
              availableAt: now,
              createdAt: now,
            },
          });
        }
      },
      {},
      db,
    );
    ctx.logger.info("order status changed", { orderId, status: to });
    return getOrder(orderId, actor.permissions);
  }

  return {
    listMyOrders,
    getMyOrder,
    listOrders,
    getOrder,
    confirmOrder: (a: OrderActor, id: string, ctx: Ctx) => staffStep("confirm", a, id, ctx),
    startPreparing: (a: OrderActor, id: string, ctx: Ctx) =>
      staffStep("startPreparing", a, id, ctx),
    markReadyForShipment: (a: OrderActor, id: string, ctx: Ctx) =>
      staffStep("markReadyForShipment", a, id, ctx),
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;

let defaultService: OrdersService | undefined;

export function getOrdersService(): OrdersService {
  defaultService ??= createOrdersService({ db: getDb(), clock: systemClock });
  return defaultService;
}
