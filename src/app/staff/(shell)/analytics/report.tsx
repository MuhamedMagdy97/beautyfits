"use client";

import { useState } from "react";
import { Card, Loaded, Pager, StatusBadge, Table, useApiData } from "../../_components/catalog-ui";
import { Notice } from "../../_components/ui";
import { percent } from "../../_lib/analytics";
import { useAnalyticsT } from "../../_lib/analytics-i18n";
import { formatPiastres } from "../../_lib/money";

/**
 * Blocks of the analytics reports (TASK-052A, ADR-0065) over the TASK-051
 * endpoints. The API computes every figure; bars are plain CSS widths with
 * the number written next to them.
 */

interface Period {
  from: string;
  to: string;
}

interface Costs {
  cogs?: number;
  estimatedGrossProfit?: number;
  revenueWithoutCost?: number;
  linesWithoutCost?: number;
}

export interface Overview extends Costs {
  period: Period;
  orders: { count: number; byStatus: Record<string, number> };
  revenue: number;
  shippingFees: number;
  averageOrderValue: number;
  customers: { new: number; ordering: number; guestOrders: number };
  visitors: number;
  productViews: { visitors: number; events: number };
  daily: ({ date: string; orders: number; revenue: number } & Costs)[];
}

interface Step {
  visitors: number;
  events: number;
}

interface Funnel {
  visitors: number;
  productViews: Step;
  addToCart: Step;
  checkoutStarted: Step;
  checkoutAbandoned: Step;
  orderCreated: Step;
  ordersDelivered: number;
}

interface ProductRow extends Costs {
  productId: string;
  name: { ar: string; en: string };
  views: number;
  addToCart: number;
  unitsSold: number;
  revenue: number;
}

export function useMoney(): (piastres: number | undefined) => string {
  const { x } = useAnalyticsT();
  return (piastres) => `${formatPiastres(piastres ?? 0)} ${x.egp}`;
}

export function Tiles({ items }: { items: [label: string, value: string | number][] }) {
  return (
    <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-line bg-white p-4">
          <dt className="text-sm text-ink-soft">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A labelled bar; the value text is the accessible content, the bar decoration. */
function Bar({ value, max, text }: { value: number; max: number; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 min-w-24 flex-1 rounded-full bg-velvet-low" aria-hidden>
        <div
          className="h-3 rounded-full bg-plum"
          style={{ width: `${percent(Math.max(value, 0), max)}%` }}
        />
      </div>
      <span className="w-44 shrink-0 text-end whitespace-nowrap tabular-nums">{text}</span>
    </div>
  );
}

/** KPIs, revenue by day and orders by status. */
export function OverviewReport({ query }: { query: string }) {
  const { x } = useAnalyticsT();
  const money = useMoney();
  const { state, reload } = useApiData<Overview>(`/api/v1/admin/analytics/overview?${query}`);
  return (
    <Loaded load={state} reload={reload}>
      {(data) => {
        const max = Math.max(0, ...data.daily.map((d) => d.revenue));
        return (
          <>
            <p className="mb-3 text-sm text-ink-soft">
              {x.periodShown.replace("{from}", data.period.from).replace("{to}", data.period.to)}
            </p>
            <Tiles
              items={[
                [x.revenue, money(data.revenue)],
                [x.orders, data.orders.count],
                [x.averageOrderValue, money(data.averageOrderValue)],
                [x.newCustomers, data.customers.new],
                [x.orderingCustomers, data.customers.ordering],
                [x.guestOrders, data.customers.guestOrders],
                [x.shippingFees, money(data.shippingFees)],
                [x.visitors, data.visitors],
              ]}
            />
            <p className="mb-6 text-xs text-ink-soft">{x.revenueNote}</p>
            <Card title={x.daily}>
              <Table head={[x.date, x.orders, x.revenue]}>
                {data.daily.map((day) => (
                  <tr key={day.date}>
                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{day.date}</td>
                    <td className="px-3 py-1.5 tabular-nums">{day.orders}</td>
                    <td className="w-full px-3 py-1.5">
                      <Bar value={day.revenue} max={max} text={money(day.revenue)} />
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title={x.ordersByStatus}>
              {Object.keys(data.orders.byStatus).length === 0 ? (
                <p className="text-ink-soft">{x.noActivity}</p>
              ) : (
                <ul className="flex flex-wrap gap-3">
                  {Object.entries(data.orders.byStatus).map(([status, count]) => (
                    <li key={status} className="flex items-center gap-2">
                      <StatusBadge status={status} />
                      <span className="tabular-nums">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        );
      }}
    </Loaded>
  );
}

export function FunnelReport({ query }: { query: string }) {
  const { x } = useAnalyticsT();
  const { state, reload } = useApiData<Funnel>(`/api/v1/admin/analytics/funnel?${query}`);
  return (
    <Loaded load={state} reload={reload}>
      {(data) => {
        const steps: [string, Step][] = [
          ["visitors", { visitors: data.visitors, events: data.visitors }],
          ["productViews", data.productViews],
          ["addToCart", data.addToCart],
          ["checkoutStarted", data.checkoutStarted],
          ["orderCreated", data.orderCreated],
          ["checkoutAbandoned", data.checkoutAbandoned],
        ];
        return (
          <Card title={x.funnel}>
            <p className="mb-4 text-sm text-ink-soft">{x.funnelNote}</p>
            <Table head={[x.funnel, x.visitors, x.events]}>
              {steps.map(([key, step]) => (
                <tr key={key}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{x.steps[key]}</td>
                  <td className="w-full px-3 py-1.5">
                    <Bar
                      value={step.visitors}
                      max={data.visitors}
                      text={`${step.visitors} · ${x.ofVisitors.replace("{n}", String(percent(step.visitors, data.visitors)))}`}
                    />
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {key === "visitors" ? "" : step.events}
                  </td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-sm text-ink">
              {x.ordersDelivered}: <span className="tabular-nums">{data.ordersDelivered}</span>
            </p>
          </Card>
        );
      }}
    </Loaded>
  );
}

const PAGE_SIZE = 20;

export function ProductsReport({ query }: { query: string }) {
  const { x, english } = useAnalyticsT();
  const money = useMoney();
  const [page, setPage] = useState(1);
  const { state, reload } = useApiData<{ items: ProductRow[] }>(
    `/api/v1/admin/analytics/products?${query}&page=${page}&pageSize=${PAGE_SIZE}`,
  );
  return (
    <Card title={x.products}>
      <Loaded load={state} reload={reload}>
        {({ items }) => {
          const costs = items.some((item) => item.cogs !== undefined);
          return items.length === 0 && page === 1 ? (
            <p className="text-ink-soft">{x.noActivity}</p>
          ) : (
            <>
              <Table
                head={[
                  x.product,
                  x.views,
                  x.addToCart,
                  x.unitsSold,
                  x.revenue,
                  ...(costs ? [x.cogs, x.grossProfit] : []),
                ]}
              >
                {items.map((item) => (
                  <tr key={item.productId}>
                    <td className="px-3 py-1.5">{english ? item.name.en : item.name.ar}</td>
                    <td className="px-3 py-1.5 tabular-nums">{item.views}</td>
                    <td className="px-3 py-1.5 tabular-nums">{item.addToCart}</td>
                    <td className="px-3 py-1.5 tabular-nums">{item.unitsSold}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                      {money(item.revenue)}
                    </td>
                    {costs ? (
                      <>
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                          {money(item.cogs)}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                          {money(item.estimatedGrossProfit)}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </Table>
              <Pager page={page} count={items.length} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
          );
        }}
      </Loaded>
    </Card>
  );
}

/** COGS and estimated gross profit (`VIEW_PROFIT` only; the page asks only then). */
export function ProfitReport({ query }: { query: string }) {
  const { x } = useAnalyticsT();
  const money = useMoney();
  const { state, reload } = useApiData<
    Required<Costs> & { revenue: number; daily: Overview["daily"] }
  >(`/api/v1/admin/analytics/profit?${query}`);
  return (
    <Card title={x.profit}>
      <Loaded load={state} reload={reload}>
        {(data) => (
          <>
            <p className="mb-4 text-sm text-ink-soft">{x.profitNote}</p>
            <Tiles
              items={[
                [x.revenue, money(data.revenue)],
                [x.cogs, money(data.cogs)],
                [x.grossProfit, money(data.estimatedGrossProfit)],
              ]}
            />
            {data.linesWithoutCost > 0 ? (
              <Notice tone="info">
                {x.withoutCost
                  .replace("{n}", String(data.linesWithoutCost))
                  .replace("{amount}", formatPiastres(data.revenueWithoutCost) ?? "0.00")}
              </Notice>
            ) : null}
            <Table head={[x.date, x.revenue, x.cogs, x.grossProfit]}>
              {data.daily.map((day) => (
                <tr key={day.date}>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{day.date}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                    {money(day.revenue)}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{money(day.cogs)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                    {money(day.estimatedGrossProfit)}
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Loaded>
    </Card>
  );
}
