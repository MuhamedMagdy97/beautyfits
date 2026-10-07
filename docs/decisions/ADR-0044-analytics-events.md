# ADR-0044 — Analytics Event Collection

- **Status:** Accepted (TASK-050)
- **Date:** 2026-10-07
- **Relates to:** ADR-0013 (rate limit buckets, client IP), ADR-0031 (cart, job script pattern), ADR-0035 (checkout); Business Spec Q145–Q148, R34, R35; User Flows §19; Architecture §18; API §27 and "TASK-050 Amendments"; DB Design §19 and "v1.2 TASK-050 Amendments"

## 1. Who records which event

- **Client-submitted** (`POST /analytics/events`): `PRODUCT_VIEW` and `CHECKOUT_STARTED` — only the client knows a product page was seen or checkout was opened. The server still checks them: a view needs a published product; a checkout start needs the shopper's non-empty cart and is stored against that cart.
- **Server-recorded**: `ADD_TO_CART` after a successful `POST /cart/items`, `ORDER_CREATED` after a successful `POST /checkout`. They follow the authoritative write instead of trusting a client.
- **Job**: `CHECKOUT_ABANDONED` (`npm run jobs:record-checkout-abandonments`).

Order confirmation, delivery and returns are not copied into analytics: `order_status_history` is authoritative and TASK-051 reads it.

## 2. Analytics never fails a business request

Server events are written after the business transaction commits (Architecture principle 6), through `trackSafely`, which logs and swallows errors. There is no outbox worker yet, and a lost analytics row only weakens a statistic, while orders stay authoritative. `ORDER_CREATED` uses `dedupe_key = ORDER_CREATED:<orderId>` (insert `ON CONFLICT DO NOTHING`), so idempotent checkout replays record it once.

## 3. Visitor identity and privacy

A visitor is a signed-in customer (`customer_id`) or the random `X-Anonymous-Id` UUID the client keeps (Q146: no named identity). The header is required for guests on the analytics endpoint (refresh filtering needs it) and optional elsewhere. No IP address, user agent, contact data or cart token is stored. The table has no foreign keys, so deleting a cart (R34) or anonymizing a customer never touches analytics, and analytics never blocks them.

## 4. Noise filtering (Q145)

- Obvious bots: a missing `User-Agent` or one matching a crawler/automation pattern is accepted (`202`) but not stored.
- Refresh noise: the same visitor viewing the same product again within 30 minutes is not stored. The window is a technical filter (Q145 leaves the filter to the implementation) and is one constant, `PRODUCT_VIEW_REPEAT_MS`.
- Checkout start: one open start per cart; a new one counts only after the open one was recorded as abandoned. An order converts the cart, so the next checkout is a new cart.

## 5. Abandonment

A checkout start whose cart is not `CONVERTED` after `CHECKOUT_ABANDONMENT_MS` gets one `CHECKOUT_ABANDONED` (`dedupe_key = CHECKOUT_ABANDONED:<startEventId>`); a deleted cart counts as abandoned. The cart itself is not marked (R35 keeps `ABANDONED` out of cart expiry). The threshold is a provisional 24 hours pending a business decision (TASK-050 open items).

## 6. Rate limit

`POST /analytics/events` uses the `rate_limit_buckets` counters (ADR-0013): 1000 events per IP per hour, then blocked for an hour (`429 RATE_LIMITED`). The value is generous because many mobile users share carrier IPs and a block only loses statistics; it is pending owner confirmation like the other per-endpoint limits.

## Consequences

- TASK-051 builds the funnel from these events plus `orders` / `order_status_history`.
- New event types (page view, order delivered, return requested) add enum values in their tasks.
- TASK-066 schedules the abandonment job hourly; TASK-061 may revisit the rate limit.
