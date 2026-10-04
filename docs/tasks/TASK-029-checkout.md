# TASK-029 — Atomic Checkout Engine

## Goal
A guest or customer turns their cart into a COD order in one transaction: everything is recomputed by the backend, stock and wallet credit are held, the discount use is counted, and a retried request never creates a second order.

## Dependencies
TASK-020 (inventory reservations), TASK-025 (cart), TASK-026 (discounts), TASK-027 (shipping), TASK-028 (wallet), TASK-005 (transactions, outbox).

## Source of Truth
- Business Spec Q28, Q37–Q40, Q46, C1, C4, R31, R36, R37
- User Flows §6.2–§6.4, §12.2
- Architecture §9–§10
- DB Design §7, §8, §23, "Order financial fields", "v1.2 TASK-029 Amendments"
- API Contract §9, §15, "TASK-029 Amendments"

## Scope
- `POST /checkout/validate` and `POST /checkout` (guest and customer).
- Tables `orders`, `order_items`, `order_status_history`, `checkout_attempts`; order number sequence.
- Order and item snapshots (contact, address, product names, SKU, image, price, cost, discount, shipping rule), discount split per line.
- Transaction: order + items + first status, stock reservation, discount usage, wallet hold, cart converted, checkout attempt, `ORDER_CREATED` outbox event.

## Non-Goals
- Order read APIs, status transitions, cancellation, COD confirmation and expiry (TASK-030 → TASK-033); `order_id` foreign keys on reservation/usage tables (TASK-030); the outbox worker and messages; website UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_orders_checkout/`
- `src/server/modules/checkout/` (`checkout-service.ts`, `schemas.ts`)
- Reused: `cart-service.ts` (`loadView`, `liveGuestCart` exported), `discounts/engine.ts` (`isTargeted` exported), `customers/schemas.ts` (`addressFields` exported), `wallet-service.ts` (`availableWalletCredit`), `money.ts` (`allocate`)
- `src/app/api/v1/checkout/route.ts`, `src/app/api/v1/checkout/validate/route.ts`
- Docs: ADR-0035, DB Design / API Contract "TASK-029 Amendments"

## Business Rules
- Q37: a changed price needs review before ordering. Q38: the discount is rechecked; an invalid one is refused, not trusted.
- Q39: one order per Idempotency-Key. Q40: one transaction; messages after commit (outbox).
- Q28: stock reserved at order creation. Q46: snapshots, not references.
- C4/Q167/Q168: wallet full or partial, rest COD; full coverage needs no COD confirmation.
- R36: the discount use counts at order creation. R37: one fee from the most specific rule, free from the threshold, no rule = no order.

## API Changes
API Contract "TASK-029 Amendments".

## Database Changes
Migration `orders_checkout`. DB Design "v1.2 TASK-029 Amendments".

## Security / Authorization
Guests use their cart token; customers their session (a bad token is 401). Only the backend computes prices, discount, shipping and totals; the client's `expectedTotal` is compared, never used. Saved addresses are the caller's own (404 otherwise). Wallet only for the signed-in owner, checked under the wallet lock. Checkout is rate-limited per IP. Logs carry ids only.

## Acceptance Criteria
- Validate and checkout return the same authoritative totals; checkout refuses a changed price, stock, discount or total and writes nothing.
- The order, items, first status, reservations, discount use, wallet hold, converted cart, attempt and outbox event commit together.
- The same key and body return the same order; another body is `IDEMPOTENCY_CONFLICT`.
- Concurrent checkouts never sell the last unit twice.
- Wallet covering the total starts the order `NEW`; otherwise `PENDING_CONFIRMATION` with the COD remainder.
- All required checks pass.

## Tests
- Integration `src/app/api/v1/checkout/checkout-routes.int.test.ts`: guest validate + order with snapshots, reservations, cart, outbox; idempotent replay/conflict/missing key; changed total, price, stock; contact/area/shipping rule; last-unit race; targeted discount split and usage limit; customer saved address with wallet + COD, insufficient credit; wallet covering the total; another customer's address; append-only history.
- Unit `src/server/money/money.test.ts`: `allocate`.

## Edge Cases
- 3000 EGP discounted to 2400 EGP pays shipping (threshold after discounts).
- A key reused after a failed checkout works (nothing was stored).
- The discount's last use taken by another order meanwhile: `DISCOUNT_INVALID USAGE_LIMIT_REACHED` at checkout.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- Owner to confirm the defaults chosen here (ADR-0035 §4): order number format `BF-100001`; discount split over targeted lines in proportion; guest email optional; 20 checkouts per IP per hour; checkout refused (not silently re-priced) when anything changed.
- [BUSINESS DECISION REQUIRED] Tax rate value (C1) — still open; `tax_amount`/`tax_rate` stay null.
- [BUSINESS DECISION REQUIRED] Guest marketing consent at checkout (DB Design "v1.2 TASK-002A Amendments") — not collected.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
