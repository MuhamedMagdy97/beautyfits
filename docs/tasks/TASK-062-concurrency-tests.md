# TASK-062 — Concurrency & Reliability Tests

## Goal
Stress the critical races against real PostgreSQL: last-stock checkout, duplicate checkout, wallet double-spend, duplicate webhook, repeated refund request and concurrent edits (Roadmap TASK-062, Test Strategy §6).

## Dependencies
TASK-020 (reservations), TASK-028 (wallet), TASK-029 (checkout), TASK-031 (COD), TASK-033/035 (cancellation, revisions), TASK-023 (receiving), TASK-040/041 (refund rules and completion).

## Source of Truth
- `docs/testing/test-strategy.md` §4, §5 (invariants 2, 3, 6, 14), §6
- `docs/api/api-contract.md` (Idempotency-Key, Shipping Webhook)
- ADR-0010 (integration tests), ADR-0068 (wallet refund completion)

## Scope
1. Inventory the races already covered by integration tests.
2. Add the missing ones as integration tests, with a small shared helper for running N operations at once.
3. Fix any bug the tests expose (none found).

### Already covered before TASK-062
| Race | Test |
|---|---|
| Two guests, last unit (checkout) | `checkout-routes.int.test.ts` "never sells the last unit twice" |
| Sequential replay / conflicting reuse of a checkout key | `checkout-routes.int.test.ts` "is idempotent per key…" |
| Reservations: 10 orders for 3 units, opposite lock order, repeated release | `reservations.int.test.ts` "concurrency" |
| Wallet holds: 5 orders spending the same credit | `wallet-routes.int.test.ts` "never lets two orders spend the same credit" |
| Return completion (repeated refund request), same and different keys | `returns-routes.int.test.ts` "never credits twice when completions race" (plus the partial unique index on `RETURN_REFUND`) |
| Concurrent inspections of one return line | `returns-routes.int.test.ts` "serializes concurrent inspections…" |
| Concurrent manual stock adjustments | `inventory-routes.int.test.ts` "serializes concurrent adjustments…" |
| Discount total usage limit | `discounts-routes.int.test.ts` "never lets concurrent orders pass the overall limit" |
| Approvals, RBAC, auth, catalog, bootstrap duplicates | their own `*.int.test.ts` |

### Added by TASK-062 (`src/app/api/v1/concurrency.int.test.ts`)
| Race | Invariant checked |
|---|---|
| 8 guests check out at once for the last 2 units | exactly 2 orders, others `STOCK_CHANGED`; balance = sum of movements, never negative |
| Same `Idempotency-Key` sent 5 times at once | one order, all responses the same order |
| One customer submits the cart with 4 different keys at once | one order, others `CART_EMPTY` |
| 6 manual wallet debits beyond the balance at once | 2 succeed, balance never negative, balance = ledger credits − debits |
| Same wallet adjustment key sent 5 times at once | one ledger entry |
| Checkout wallet use racing manual debits | the credit is spent once; held ≤ balance |
| COD link confirmation (before the deadline) racing the expiry job (after it), 3 rounds | exactly one wins; stock held or released to match |
| Expiry job run 3 times at once | one `EXPIRED` transition, one event, stock and wallet hold released once |
| Customer and staff cancelling at once | one cancellation, holds released once |
| Staff confirm / start-preparing racing a customer cancel | one gap-free status history ending `CANCELLED` |
| One revision confirmed 3 times at once | applied once, stock reserved once |
| Revision confirmation racing a cancellation | no stock left reserved |
| Same goods receipt retried 4 times at once | one receipt, stock added once |
| Two partial deliveries received at once | both counted, weighted average cost unchanged |

Every check also asserts that each order's status history is a gap-free chain, inventory balances equal the sum of their movements, and wallet balances equal their ledger.

## Non-Goals
- Load/performance testing.
- New endpoints or behavior changes.

## Files / Modules
- `src/test/integration/concurrently.ts` — `concurrently(n, fn)`, `fulfilled`, `rejected` (test-only).
- `src/app/api/v1/concurrency.int.test.ts` — the new race tests.

## Business Rules
None added or changed.

## API Changes
None.

## Database Changes
None.

## Security / Authorization
No change. Staff actions in the tests run as an Owner through the services (permission checks are covered by each feature's route tests).

## Acceptance Criteria
- Each roadmap race is covered by an integration test or recorded below as not applicable.
- The new tests pass repeatedly (run 6 times in a row without failure).

## Tests
See Scope. Run with `npm run test:integration`.

## Edge Cases
- Outcomes that depend on which transaction locks first (COD confirm vs expiry, checkout vs debit, revision vs cancel) assert the invariant of each possible order instead of one fixed winner.

## Definition of Done
Required checks green; task file, roadmap and test strategy updated.

## Open Items
- **Duplicate webhook delivery: not applicable yet.** No webhook endpoint exists in the code (`grep -ri webhook src` finds none). API Contract "Shipping Webhook" (`POST /webhooks/shipping/{provider}`, idempotent by provider event id) is planned but not implemented; its duplicate-delivery race test belongs to the task that adds it. Payments are COD/wallet only, so there is no payment webhook.
- No bugs were found: every race was already serialized by row locks (customer, cart, order, wallet, purchase order, inventory balances) or unique constraints.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
