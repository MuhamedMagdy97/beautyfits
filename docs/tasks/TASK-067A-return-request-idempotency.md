# TASK-067A — Return request idempotency

## Goal
A retried `POST /orders/{orderId}/returns` must not create a second return. Follow-up of TASK-067 checklist item 17.

## Dependencies
TASK-037 (return requests), TASK-067 (mobile API readiness review).

## Source of Truth
- `docs/api/api-contract.md` §9, "Idempotency (completes §9)", TASK-067A Amendments
- `docs/tasks/TASK-067-mobile-api-readiness.md` (item 17)
- Existing pattern: `checkout-service.ts`, `goods-receipts-service.ts` (`idempotency_keys`)

## Scope
- Optional `Idempotency-Key` header on `POST /orders/{orderId}/returns`.
- Same key and body: the return already created (`201`). Same key, other order or body: `409 IDEMPOTENCY_CONFLICT`. No key: unchanged behaviour.

## Non-Goals
- Making the key required (would break existing clients).
- Website client sending the key (separate UI change).
- Keys on other customer creates (reviews and wishlist are already safe to retry, TASK-067 item 17).

## Files / Modules
- `src/server/http/validation.ts` — `optionalIdempotencyKey`
- `src/app/api/v1/orders/[orderId]/returns/route.ts`
- `src/server/modules/returns/returns-service.ts` — `createReturn`
- `src/app/api/v1/returns/returns-routes.int.test.ts`
- `docs/api/api-contract.md`

## Business Rules
No business rule changes. Return quantities, window and evidence rules are unchanged.

## API Changes
Additive optional header; see TASK-067A Amendments in the API contract.

## Database Changes
None. Uses the existing `idempotency_keys` table (scope `CUSTOMER:<id>`, operation `RETURN_CREATE`, 7-day expiry), written in the return's transaction.

## Security / Authorization
Keys are scoped per customer, so a key never replays another customer's return. The fingerprint covers the order id and the validated body. The order row lock serializes retries of the same key.

## Acceptance Criteria
- A retry with the same key and body returns the same return; only one return and one audit entry exist.
- The same key with another body is `409 IDEMPOTENCY_CONFLICT`.
- A malformed key is `400 VALIDATION_ERROR` (`idempotency_key_invalid`).
- Requests without the header behave as before.

## Tests
Integration: `returns-routes.int.test.ts` — "returns the same return for a retry with the same Idempotency-Key (TASK-067A)". Existing return tests cover the no-key path.

## Edge Cases
- A failed request (e.g. quantity exceeded) stores no key, so it can be retried with the same key.
- The same key sent at the same time for two different orders: the unique index refuses the second as `IDEMPOTENCY_CONFLICT`.

## Definition of Done
Required checks pass (lint, format:check, typecheck, test, test:integration, build); contract updated; committed on a feature branch.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
