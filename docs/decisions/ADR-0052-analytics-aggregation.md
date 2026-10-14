# ADR-0052 — Analytics Aggregation & Profit Metrics

- **Status:** Accepted (TASK-051)
- **Date:** 2026-10-14
- **Relates to:** ADR-0044 (analytics events), ADR-0011 (money), ADR-0036 (order core); Business Spec Q103, Q149, Q150, R20; User Flows §19; API §27 and "TASK-051 Amendments"; permission catalog (`ANALYTICS_VIEW`, `VIEW_PROFIT`)

## 1. Query on read, no rollup tables

Reports are computed by SQL at request time from `orders`, `order_items`, `customers` and `analytics_events`. There is no aggregate table, no job and no migration. Periods are at most 366 days, and the existing indexes (`orders (status, created_at)`, `order_items (order_id, …)`, `analytics_events (event_type, occurred_at)`) cover the filters. Rollups can be added later (TASK-061/066) if the queries get slow; the API does not change.

## 2. Which numbers come from where

- Sales (orders, revenue, AOV, COGS, profit, products sold) come from the authoritative order tables, never from `ORDER_CREATED` events (Architecture §18).
- The funnel (views → add to cart → checkout → order) comes from `analytics_events`; a visitor is `COALESCE(customer_id, anonymous_id)`. Each step counts what happened in the period independently (not a per-visitor cohort), so steps need not shrink monotonically. `ordersDelivered` is counted from `orders` (orders created in the period that are now `DELIVERED`).

## 3. Revenue, COGS and estimated gross profit

- **Revenue** = sum of `order_items.line_total` (selling price × quantity minus the line's share of the discount), tax-inclusive (C1). Shipping fees are reported separately, not in revenue.
- **Revenue orders**: provisionally `NEW`, `CONFIRMED`, `PREPARING`, `READY_FOR_SHIPMENT`, `SHIPPED`, `DELIVERED`, dated by order creation in Africa/Cairo (`REVENUE_ORDER_STATUSES`). This is a business decision that was not made; it is one constant and listed as `[BUSINESS DECISION REQUIRED]` in the task file.
- **COGS** = `unit_cost_at_sale × quantity` (Q103: weighted average cost stored at sale), so profit history never changes with later purchases.
- **Estimated gross profit** (Q150) = revenue − COGS over the lines that have a cost. Lines without `unit_cost_at_sale` are reported as `revenueWithoutCost` / `linesWithoutCost` rather than counted as zero-cost profit.
- **AOV** = revenue ÷ revenue orders, rounded HALF-UP to a piastre. All amounts are integer piastres.
- Returns and refunds are not deducted: the returns domain does not exist yet (TASK-037+).

## 4. Periods

`range` = `TODAY` | `YESTERDAY` | `7D` | `30D` | `90D` | `CUSTOM` (Q149), default `30D`, in Africa/Cairo calendar days (R20) through the `time.ts` helpers. `7D`/`30D`/`90D` include today. `CUSTOM` takes inclusive `from`/`to` dates, at most 366 days. Daily series fill empty days with zeros. Period comparison is later (Q149 note).

## 5. Permissions

- `ANALYTICS_VIEW`: overview, funnel, products.
- `VIEW_PROFIT`: the profit endpoint; on overview and products the cost fields (`cogs`, `estimatedGrossProfit`, `revenueWithoutCost`, `linesWithoutCost`) are omitted unless the employee holds it.

## Consequences

- `GET /admin/analytics/inventory` (API §27) is not built here: low stock is already `GET /admin/inventory/low-stock` (TASK-019); movement metrics wait for a task that needs them.
- The dashboard screens are a later dashboard task; they read these endpoints.
- When returns land, their effect on revenue/profit needs its own decision (Q150: "returns later").
