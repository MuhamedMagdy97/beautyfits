import { Prisma, type OrderStatus, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { roundHalfUp, toJsonNumber } from "@/server/money/money";
import type { ProductReportQuery, ReportQuery } from "@/server/modules/analytics/schemas";
import type { PermissionSet } from "@/server/modules/rbac/authorization";
import {
  addCalendarDays,
  BUSINESS_TIME_ZONE,
  localDateOf,
  localDaysRange,
  systemClock,
  type Clock,
  type LocalDate,
} from "@/server/time/time";

/**
 * Analytics reporting (TASK-051; Business Spec Q149, Q150, Q103, R20; User
 * Flows §19; API §27; ADR-0052).
 *
 * - Sales figures come from the authoritative `orders` / `order_items`;
 *   views, carts and checkouts from `analytics_events` (ADR-0044).
 * - Revenue is merchandise after discounts (`order_items.line_total`),
 *   shipping fees separate; COGS is `unit_cost_at_sale × quantity` (Q103) so
 *   history never moves with later purchases. Estimated gross profit is
 *   revenue − COGS over the lines that have a cost (Q150); lines without a
 *   cost are reported apart instead of counted as free.
 * - Cost and profit figures need `VIEW_PROFIT`.
 */

/**
 * Orders whose sales count as revenue, by the order's creation date.
 * Owner decision 2026-10-15: confirmed orders onward (CONFIRMED to DELIVERED),
 * shipping excluded. PENDING_CONFIRMATION, NEW, CANCELLED and EXPIRED do not count.
 */
export const REVENUE_ORDER_STATUSES: readonly OrderStatus[] = [
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_SHIPMENT",
  "SHIPPED",
  "DELIVERED",
];

export interface ReportPeriod {
  range: ReportQuery["range"];
  from: LocalDate;
  to: LocalDate;
  timeZone: string;
  start: Date;
  end: Date;
}

/** Calendar days of a report in Africa/Cairo (R20); `7D` is today and the 6 days before. */
export function resolvePeriod(query: ReportQuery, now: Date): ReportPeriod {
  const today = localDateOf(now);
  let from: LocalDate;
  let to: LocalDate = today;
  switch (query.range) {
    case "TODAY":
      from = today;
      break;
    case "YESTERDAY":
      from = to = addCalendarDays(today, -1);
      break;
    case "7D":
    case "30D":
    case "90D":
      from = addCalendarDays(today, 1 - Number.parseInt(query.range, 10));
      break;
    case "CUSTOM":
      from = query.from!;
      to = query.to!;
      break;
  }
  const { start, end } = localDaysRange(from, to);
  return { range: query.range, from, to, timeZone: BUSINESS_TIME_ZONE, start, end };
}

/** `numerator / denominator` rounded HALF-UP, 0 when nothing to divide. */
function average(numerator: bigint, denominator: number): bigint {
  return denominator === 0 ? BigInt(0) : roundHalfUp(numerator, BigInt(denominator));
}

const money = toJsonNumber;

function periodJson(p: ReportPeriod) {
  return { range: p.range, from: p.from, to: p.to, timeZone: p.timeZone };
}

interface DayRow {
  day: string;
  orders: number;
  revenue: bigint;
  shipping: bigint;
  cogs: bigint;
  revenue_without_cost: bigint;
  lines_without_cost: number;
}

export function createReportingService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;
  const statuses = REVENUE_ORDER_STATUSES as string[];

  /** Sales of revenue orders per Cairo day, every day of the period present. */
  async function salesByDay(p: ReportPeriod) {
    const rows = await db.$queryRaw<DayRow[]>`
      WITH o AS (
        SELECT id, shipping_fee, created_at FROM orders
        WHERE created_at >= ${p.start}::timestamptz AND created_at < ${p.end}::timestamptz
          AND status::text = ANY(${statuses}::text[])
      ), l AS (
        SELECT i.order_id,
          SUM(i.line_total) AS revenue,
          COALESCE(SUM(i.unit_cost_at_sale * i.quantity), 0) AS cogs,
          COALESCE(SUM(i.line_total) FILTER (WHERE i.unit_cost_at_sale IS NULL), 0) AS revenue_without_cost,
          COUNT(*) FILTER (WHERE i.unit_cost_at_sale IS NULL) AS lines_without_cost
        FROM order_items i JOIN o ON o.id = i.order_id GROUP BY i.order_id
      )
      SELECT to_char(o.created_at AT TIME ZONE ${BUSINESS_TIME_ZONE}, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS orders,
        COALESCE(SUM(l.revenue), 0)::bigint AS revenue,
        COALESCE(SUM(o.shipping_fee), 0)::bigint AS shipping,
        COALESCE(SUM(l.cogs), 0)::bigint AS cogs,
        COALESCE(SUM(l.revenue_without_cost), 0)::bigint AS revenue_without_cost,
        COALESCE(SUM(l.lines_without_cost), 0)::int AS lines_without_cost
      FROM o LEFT JOIN l ON l.order_id = o.id
      GROUP BY 1`;
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const zero = BigInt(0);
    const days: DayRow[] = [];
    for (let day = p.from; day <= p.to; day = addCalendarDays(day, 1)) {
      days.push(
        byDay.get(day) ?? {
          day,
          orders: 0,
          revenue: zero,
          shipping: zero,
          cogs: zero,
          revenue_without_cost: zero,
          lines_without_cost: 0,
        },
      );
    }
    const total = days.reduce((sum, d) => ({
      day: "",
      orders: sum.orders + d.orders,
      revenue: sum.revenue + d.revenue,
      shipping: sum.shipping + d.shipping,
      cogs: sum.cogs + d.cogs,
      revenue_without_cost: sum.revenue_without_cost + d.revenue_without_cost,
      lines_without_cost: sum.lines_without_cost + d.lines_without_cost,
    }));
    return { days, total };
  }

  function profitJson(d: DayRow) {
    return {
      cogs: money(d.cogs),
      estimatedGrossProfit: money(d.revenue - d.revenue_without_cost - d.cogs),
      revenueWithoutCost: money(d.revenue_without_cost),
      linesWithoutCost: d.lines_without_cost,
    };
  }

  /** Visitors (customer or anonymous id) and events per funnel step (ADR-0044). */
  async function funnelCounts(p: ReportPeriod) {
    const rows = await db.$queryRaw<
      { event_type: string | null; events: number; visitors: number }[]
    >`
      SELECT event_type::text AS event_type, COUNT(*)::int AS events,
        COUNT(DISTINCT COALESCE(customer_id, anonymous_id))::int AS visitors
      FROM analytics_events
      WHERE occurred_at >= ${p.start}::timestamptz AND occurred_at < ${p.end}::timestamptz
      GROUP BY GROUPING SETS ((event_type), ())`;
    const step = (type: string | null) => {
      const row = rows.find((r) => r.event_type === type);
      return { visitors: row?.visitors ?? 0, events: row?.events ?? 0 };
    };
    return {
      visitors: step(null).visitors,
      productViews: step("PRODUCT_VIEW"),
      addToCart: step("ADD_TO_CART"),
      checkoutStarted: step("CHECKOUT_STARTED"),
      checkoutAbandoned: step("CHECKOUT_ABANDONED"),
      orderCreated: step("ORDER_CREATED"),
    };
  }

  /** `GET /admin/analytics/overview` (`ANALYTICS_VIEW`; costs with `VIEW_PROFIT`). */
  async function overview(query: ReportQuery, permissions: PermissionSet) {
    const p = resolvePeriod(query, clock.now());
    const [sales, byStatus, customers, funnel] = await Promise.all([
      salesByDay(p),
      db.order.groupBy({
        by: ["status"],
        where: { createdAt: { gte: p.start, lt: p.end } },
        _count: { _all: true },
      }),
      db.$queryRaw<{ new_customers: number; ordering_customers: number; guest_orders: number }[]>`
        SELECT
          (SELECT COUNT(*)::int FROM customers
            WHERE created_at >= ${p.start}::timestamptz AND created_at < ${p.end}::timestamptz) AS new_customers,
          COUNT(DISTINCT customer_id)::int AS ordering_customers,
          (COUNT(*) FILTER (WHERE customer_id IS NULL))::int AS guest_orders
        FROM orders
        WHERE created_at >= ${p.start}::timestamptz AND created_at < ${p.end}::timestamptz
          AND status::text = ANY(${statuses}::text[])`,
      funnelCounts(p),
    ]);
    const profit = permissions.has("VIEW_PROFIT");
    const t = sales.total;
    return {
      period: periodJson(p),
      orders: {
        count: t.orders,
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      },
      revenue: money(t.revenue),
      shippingFees: money(t.shipping),
      averageOrderValue: money(average(t.revenue, t.orders)),
      ...(profit ? profitJson(t) : {}),
      customers: {
        new: customers[0].new_customers,
        ordering: customers[0].ordering_customers,
        guestOrders: customers[0].guest_orders,
      },
      visitors: funnel.visitors,
      productViews: funnel.productViews,
      daily: sales.days.map((d) => ({
        date: d.day,
        orders: d.orders,
        revenue: money(d.revenue),
        ...(profit ? profitJson(d) : {}),
      })),
    };
  }

  /** `GET /admin/analytics/funnel` (`ANALYTICS_VIEW`). */
  async function funnel(query: ReportQuery) {
    const p = resolvePeriod(query, clock.now());
    const [counts, delivered] = await Promise.all([
      funnelCounts(p),
      db.order.count({
        where: { createdAt: { gte: p.start, lt: p.end }, status: "DELIVERED" },
      }),
    ]);
    return { period: periodJson(p), ...counts, ordersDelivered: delivered };
  }

  /** `GET /admin/analytics/profit` (`VIEW_PROFIT`). */
  async function profitReport(query: ReportQuery) {
    const p = resolvePeriod(query, clock.now());
    const { days, total } = await salesByDay(p);
    return {
      period: periodJson(p),
      orders: total.orders,
      revenue: money(total.revenue),
      ...profitJson(total),
      daily: days.map((d) => ({
        date: d.day,
        orders: d.orders,
        revenue: money(d.revenue),
        ...profitJson(d),
      })),
    };
  }

  /**
   * `GET /admin/analytics/products` (`ANALYTICS_VIEW`; costs with
   * `VIEW_PROFIT`): products with views, adds to cart or sales in the
   * period, best sellers first.
   */
  async function products(query: ProductReportQuery, permissions: PermissionSet) {
    const p = resolvePeriod(query, clock.now());
    const performance = Prisma.sql`
      WITH s AS (
        SELECT i.product_id, SUM(i.quantity)::int AS units, SUM(i.line_total)::bigint AS revenue,
          COALESCE(SUM(i.unit_cost_at_sale * i.quantity), 0)::bigint AS cogs,
          COALESCE(SUM(i.line_total) FILTER (WHERE i.unit_cost_at_sale IS NULL), 0)::bigint
            AS revenue_without_cost,
          (COUNT(*) FILTER (WHERE i.unit_cost_at_sale IS NULL))::int AS lines_without_cost
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.created_at >= ${p.start}::timestamptz AND o.created_at < ${p.end}::timestamptz
          AND o.status::text = ANY(${statuses}::text[])
        GROUP BY i.product_id
      ), e AS (
        SELECT entity_id AS product_id,
          (COUNT(*) FILTER (WHERE event_type = 'PRODUCT_VIEW'))::int AS views,
          (COUNT(*) FILTER (WHERE event_type = 'ADD_TO_CART'))::int AS adds
        FROM analytics_events
        WHERE entity_type = 'PRODUCT' AND event_type IN ('PRODUCT_VIEW', 'ADD_TO_CART')
          AND occurred_at >= ${p.start}::timestamptz AND occurred_at < ${p.end}::timestamptz
        GROUP BY entity_id
      ), perf AS (
        SELECT COALESCE(s.product_id, e.product_id) AS product_id,
          COALESCE(e.views, 0) AS views, COALESCE(e.adds, 0) AS adds,
          COALESCE(s.units, 0) AS units, COALESCE(s.revenue, 0) AS revenue,
          COALESCE(s.cogs, 0) AS cogs, COALESCE(s.revenue_without_cost, 0) AS revenue_without_cost,
          COALESCE(s.lines_without_cost, 0) AS lines_without_cost
        FROM s FULL JOIN e ON e.product_id = s.product_id
      )`;
    const offset = (query.page - 1) * query.pageSize;
    const [rows, counted] = await Promise.all([
      db.$queryRaw<
        {
          product_id: string;
          name_ar: string;
          name_en: string;
          views: number;
          adds: number;
          units: number;
          revenue: bigint;
          cogs: bigint;
          revenue_without_cost: bigint;
          lines_without_cost: number;
        }[]
      >`${performance}
        SELECT perf.*, pr.name_ar, pr.name_en FROM perf JOIN products pr ON pr.id = perf.product_id
        ORDER BY perf.revenue DESC, perf.units DESC, perf.views DESC, perf.product_id
        LIMIT ${query.pageSize} OFFSET ${offset}`,
      db.$queryRaw<{ total: number }[]>`${performance} SELECT COUNT(*)::int AS total FROM perf`,
    ]);
    const profit = permissions.has("VIEW_PROFIT");
    const total = counted[0].total;
    return {
      period: periodJson(p),
      items: rows.map((r) => ({
        productId: r.product_id,
        name: { ar: r.name_ar, en: r.name_en },
        views: r.views,
        addToCart: r.adds,
        unitsSold: r.units,
        revenue: money(r.revenue),
        ...(profit
          ? {
              cogs: money(r.cogs),
              estimatedGrossProfit: money(r.revenue - r.revenue_without_cost - r.cogs),
              revenueWithoutCost: money(r.revenue_without_cost),
              linesWithoutCost: r.lines_without_cost,
            }
          : {}),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  return { overview, funnel, profitReport, products };
}

export type ReportingService = ReturnType<typeof createReportingService>;

let defaultService: ReportingService | undefined;

export function getReportingService(): ReportingService {
  defaultService ??= createReportingService({ db: getDb(), clock: systemClock });
  return defaultService;
}
