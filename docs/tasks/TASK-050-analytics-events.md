# TASK-050 — Analytics Event Collection

## Goal

Capture anonymous and customer Product View, Add to Cart, Checkout Start, Checkout Abandonment and Order events for the funnel, without ever affecting the business requests that trigger them.

## Dependencies

TASK-025 (cart), TASK-030 (orders), TASK-029 (checkout), TASK-007 (rate limit buckets).

## Source of Truth

- Business Spec Q145–Q148, R34, R35
- User Flows §19
- Architecture §18 (and principle 6)
- DB Design §19, §22, "v1.2 TASK-050 Amendments"
- API Contract §27, "TASK-050 Amendments"

## Scope

- Table `analytics_events` (enum `analytics_event_type`, `dedupe_key`).
- `POST /analytics/events`: `PRODUCT_VIEW`, `CHECKOUT_STARTED`; bot and refresh filtering; rate limit per IP.
- Server-recorded `ADD_TO_CART` (`POST /cart/items`) and `ORDER_CREATED` (`POST /checkout`, once per order).
- Job `jobs:record-checkout-abandonments` (`CHECKOUT_ABANDONED`).

## Non-Goals

- Aggregation, dashboards, profit metrics, `/admin/analytics/*` (TASK-051); page views, order confirmed/delivered and return events (read from order history or added by their tasks); website/app instrumentation (TASK-058+); job scheduling (TASK-066).

## Files / Modules

- `prisma/schema.prisma`, `prisma/migrations/20261008050000_analytics_events/`
- `src/server/modules/analytics/` (`analytics-service.ts`, `schemas.ts`, `http.ts`)
- `src/app/api/v1/analytics/events/route.ts`; one-line hooks in `src/app/api/v1/cart/items/route.ts` and `src/app/api/v1/checkout/route.ts`
- `scripts/record-checkout-abandonments.ts`, `package.json`
- Docs: ADR-0044, DB Design / API Contract "TASK-050 Amendments", roadmap note

## Business Rules

- Q145: every meaningful product view; obvious bot/refresh noise filtered.
- Q146: anonymous tracking, no named identity (`X-Anonymous-Id`).
- Q147, Q148: checkout events in the funnel; guests and accounts both appear.
- R35: cart `ABANDONED` is not used; abandonment is an analytics event.

## API Changes

API Contract "TASK-050 Amendments".

## Database Changes

Migration `analytics_events`. DB Design "v1.2 TASK-050 Amendments".

## Security / Authorization

Public endpoint, rate limited to 1000 events per IP per hour. A customer credential must be valid (`401`). Input validated with zod; product and cart resolved by the server. No IP, user agent, contact data or tokens stored; logs carry nothing extra. Analytics is never authoritative.

## Acceptance Criteria

- Product views and checkout starts are stored for guests (anonymous id) and customers; bots, 30-minute repeat views, unpublished products and cart-less starts are not.
- Add to Cart and Order Created are recorded by the server; a checkout replay records no second order event.
- Abandonment is recorded once per start after the threshold, never for a converted cart; the cart is not marked.
- An analytics failure does not fail the cart request.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/analytics/analytics-routes.int.test.ts`: bot detection, guest views and refresh window, customer link, bots/draft ignored, validation and `401`, rate limit, add-to-cart → checkout start → order (replay) → no abandonment, start without cart, abandonment threshold/once/new start, analytics failure tolerated.

## Edge Cases

- Two simultaneous identical views or starts can both be stored (no lock; minor noise).
- A deleted cart (deactivation, guest expiry) with an open start counts as abandoned.
- An order placed after the abandonment was recorded leaves both events (abandoned, then recovered).

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] Checkout abandonment time: how long after a checkout start without an order is it "abandoned"? Implemented as the constant `CHECKOUT_ABANDONMENT_MS` with a provisional 24 hours.
- [BUSINESS DECISION REQUIRED] Analytics rate limit: provisional 1000 events per IP per hour (`ANALYTICS_IP_LIMIT`); checkout and COD links had owner-set limits (R38, R39).
- [BUSINESS DECISION REQUIRED] Analytics retention: how long events are kept (no deletion implemented).
- To confirm (technical, ADR-0044 §4): the 30-minute product-view repeat window.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
