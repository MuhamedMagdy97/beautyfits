# TASK-020 — Inventory Reservation Engine

## Goal
Orders hold stock atomically and safely under concurrency: reserving moves Available to Reserved for every line or for none, a cancelled or expired order gives its stock back, and a shipped order consumes it. The last unit is never sold twice.

## Dependencies
TASK-019 (balances, movement ledger and its triggers). Used by TASK-029 (checkout reserves), TASK-031 (COD expiry releases), TASK-032 (order edits release and reserve again), TASK-033 (cancellation releases), the shipping task (commit at `SHIPPED`), and TASK-030 (adds the `orders` foreign key).

## Source of Truth
- Business Spec Q9, Q25, Q28, Q36, R11
- User Flows §13.2–13.3, order state table
- Architecture §8, §9
- DB Design §10 (`inventory_reservations`, open decision)
- API Contract §9 "Inventory concurrency"
- AGENTS.md: transactions for reservation; every inventory change produces a movement

## Scope
- `inventory_reservations` table with `ACTIVE` / `RELEASED` / `CONVERTED` and history guard.
- Movement types `RESERVATION`, `RELEASE_RESERVATION`, `CUSTOMER_ORDER_COMMIT`.
- `reserveForOrder`, `releaseForOrder`, `commitForOrder` in `src/server/modules/inventory/reservations.ts`, run inside the caller's transaction.
- All-or-nothing reservation with `STOCK_CHANGED`; deadlock-free lock order; idempotent release and commit.

## Non-Goals
- Checkout, orders and order states (TASK-029+, TASK-030+); the `orders` foreign key (TASK-030).
- Cart stock checks (TASK-025).
- Returns restocking (returns tasks).
- HTTP endpoints.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_inventory_reservations/`
- `src/server/modules/inventory/reservations.ts`
- Docs: DB Design "v1.2 TASK-020 Amendments", API Contract "TASK-020 Amendments", ADR-0025

## Business Rules
- Q9 / Q28: reserve at order creation, atomically, without overselling.
- Q25 / R11: expiry and cancellation release reserved stock.
- Q36: returned goods reach Available only after inspection (returns tasks), never by release.

## API Changes
API Contract "TASK-020 Amendments" (`STOCK_CHANGED` details).

## Database Changes
Migration `inventory_reservations`. DB Design "v1.2 TASK-020 Amendments".

## Security / Authorization
No endpoints. The engine is called only by server-side workflows that authorize their own requests. `STOCK_CHANGED` names short variants without exposing stock counts.

## Acceptance Criteria
- Reserving writes one `RESERVATION` movement and one `ACTIVE` reservation per variant, or nothing at all when any line is short.
- Concurrent orders never reserve more than Available; orders over the same variants in any order do not deadlock.
- Release returns the stock to Available, commit removes it from Reserved; both are no-ops when nothing is held, also under concurrent retries.
- Reservations are never deleted and change only once, from `ACTIVE`.
- Every balance still equals the sum of its movements; all required checks pass.

## Tests
- Unit `reservations.test.ts`: line merging and lock order, short-line detection.
- Integration `reservations.int.test.ts`: reserve/release/commit effects and movements, all-or-nothing, unknown variant, double reservation, re-reserve after release, history guard, 10 orders racing for 3 units, opposite-order deadlock check, concurrent release retries.

## Edge Cases
- The same variant on several lines (merged).
- The last units raced by many orders.
- Release after commit; commit or release retried.
- An edited order: release, then reserve again.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Decided by the product owner on 2026-10-03 (ADR-0025 §3): reserved stock is consumed when the order is **Shipped**. Technical defaults: ADR-0025 §4.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
