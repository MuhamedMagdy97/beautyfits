# TASK-051 — Analytics Aggregation & Profit Metrics

## Goal

Give the dashboard revenue, orders, customers, views, conversion funnel, COGS, estimated gross profit, AOV and product performance for a chosen period, with cost and profit figures visible only to `VIEW_PROFIT` holders.

## Dependencies

TASK-050 (analytics events), TASK-018 (costs, `VIEW_PROFIT`), TASK-030 (orders, `unit_cost_at_sale`).

## Source of Truth

- Business Spec Q103, Q149, Q150, R20
- User Flows §17.2, §19
- Architecture §18
- DB Design §19, "v1.2 TASK-051 Notes"
- API Contract §27, "TASK-051 Amendments"
- Permission catalog: `ANALYTICS_VIEW`, `VIEW_PROFIT`

## Scope

- `GET /admin/analytics/overview`, `/funnel`, `/products` (`ANALYTICS_VIEW`) and `/profit` (`VIEW_PROFIT`).
- Periods Today, Yesterday, 7D, 30D, 90D, Custom (≤ 366 days) in Africa/Cairo days; zero-filled daily series.
- Cost fields (`cogs`, `estimatedGrossProfit`, `revenueWithoutCost`, `linesWithoutCost`) only with `VIEW_PROFIT`.

## Non-Goals

- Dashboard screens (a later dashboard task reads these endpoints).
- `GET /admin/analytics/inventory`: low stock is already `GET /admin/inventory/low-stock` (TASK-019); movement metrics wait for a task that needs them.
- Period comparison (Q149 "later"), net profit (Q150 "later"), returns/refund deductions (returns domain not built), brand/category performance, rollup tables, CSV export.

## Files / Modules

- `src/server/modules/analytics/reporting-service.ts`, `schemas.ts` (report query schemas)
- `src/app/api/v1/admin/analytics/{overview,funnel,products,profit}/route.ts`
- Tests: `src/server/modules/analytics/reporting.test.ts`, `src/app/api/v1/admin/analytics/analytics-reporting.int.test.ts`
- Docs: ADR-0052, API Contract / DB Design TASK-051 sections, roadmap note

## Business Rules

- Q103: COGS uses the unit cost stored at sale; historical profit never changes.
- Q149: Today, Yesterday, 7D, 30D, 90D, Custom; comparison later.
- Q150: Estimated Gross Profit = revenue − COGS in the MVP.
- R20: calendar days in Africa/Cairo.
- Sales are read from orders; analytics events only feed the funnel and views (Architecture §18).

## API Changes

API Contract "TASK-051 Amendments".

## Database Changes

None (no migration). DB Design "v1.2 TASK-051 Notes".

## Security / Authorization

Staff session plus `ANALYTICS_VIEW`; `/profit` needs `VIEW_PROFIT`, and cost fields elsewhere are omitted without it (permission catalog, Business Spec "cost, profit … appropriate access control"). Query input validated with zod; SQL is parameterized. No customer contact data in any report.

## Acceptance Criteria

- Overview returns order counts (revenue orders and by status), revenue, shipping fees, AOV, customers, visitors, product views and a daily series for every period preset and a custom range.
- Funnel returns visitors and events for product view, add to cart, checkout started/abandoned, order created, and delivered orders.
- Products are ranked by revenue with views, adds to cart and units sold, paginated.
- COGS and estimated gross profit use `unit_cost_at_sale`; lines without a cost are reported apart.
- Cost and profit data never reach an employee without `VIEW_PROFIT`.
- All required checks pass.

## Tests

- Unit `reporting.test.ts`: Cairo day boundaries (UTC evening = next Cairo day), presets, default, custom validation.
- Integration `analytics-reporting.int.test.ts`: 401/403/400; revenue statuses exclude cancelled, expired and pending orders; AOV; customers; cost fields hidden/shown by `VIEW_PROFIT`; 7D daily series; funnel steps; product ranking; profit endpoint.

## Edge Cases

- A product line without `unit_cost_at_sale` (no weighted average cost at sale) adds to revenue but not to profit; it shows in `revenueWithoutCost`.
- An order is dated by its creation; a later status change (e.g. cancellation) moves it out of revenue for its original day.
- Guest events without an anonymous id count as events but not as visitors.
- Funnel steps are counted independently in the period, so a step can exceed the previous one.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- Resolved (owner decision 2026-10-15): revenue orders are `CONFIRMED`, `PREPARING`, `READY_FOR_SHIPMENT`, `SHIPPED` and `DELIVERED`, dated by order creation (`REVENUE_ORDER_STATUSES`). `PENDING_CONFIRMATION`, `NEW`, `CANCELLED` and `EXPIRED` do not count.
- Resolved (owner decision 2026-10-15): revenue and AOV exclude the shipping fee; shipping fees are reported separately.
- Resolved (owner decision 2026-10-18): keep current behaviour — returns and refunds do not reduce revenue, COGS or profit in reports (BD-066).
- To confirm (technical, ADR-0052 §4): `7D`/`30D`/`90D` include today; custom range limit 366 days.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
