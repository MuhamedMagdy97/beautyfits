# TASK-010 — Guest Identity & Order Claiming

## Goal
A customer who ordered as a guest can link those orders to their account, proven by an email code, never by a phone match alone.

## Dependencies
TASK-008 (email OTP), TASK-009 (profile-change OTP flow), TASK-013 (audit), TASK-029/TASK-030 (orders).

## Source of Truth
- Business Spec Q43, Q44, R16, R30, R31
- User Flows §3.5
- DB Design §3 (`otp_challenges`), "v1.2 TASK-030 Amendments" (`orders_immutable`)
- API Contract §12
- Security Requirements §3
- ADR-0014, ADR-0030, ADR-0036; new ADR-0046

## Scope
- `POST /guest/orders/claim` and `POST /guest/orders/claim/verify`.
- `GUEST_ORDER_CLAIM` code email (Arabic and English).
- Audit action `ORDER_CLAIMED`.

## Non-Goals
- Support-assisted linking of guest orders with another or missing email (see Open Items).
- Website/app UI (offering the claim after registration).

## Files / Modules
- `src/server/modules/customers/profile-service.ts` (`requestGuestOrderClaim`, `confirmGuestOrderClaim`)
- `src/server/modules/auth/otp.ts` (purpose and templates), `src/server/modules/audit/audit.ts`
- `src/app/api/v1/guest/orders/claim/route.ts`, `.../claim/verify/route.ts`
- `src/test/integration/orders.ts` (`bareOrder` takes guest phone/email)
- Docs: ADR-0046, API Contract "TASK-010 Amendments", DB Design "v1.2 TASK-010 Amendments", roadmap

## Business Rules
- Q44/R31: only guest orders whose phone **and** email both match the account are linked, after an email code sent to the order's `guest_email`.
- R31: guest orders with another or missing email are linked only through support.
- An order is linked once and never moves to another account (TASK-030).

## API Changes
API Contract "TASK-010 Amendments".

## Database Changes
None (no migration). DB Design "v1.2 TASK-010 Amendments" records the use of the existing columns.

## Security / Authorization
ACTIVE customer session (cookie requests pass the Origin check). Eligibility is computed by the backend from the account's own email and phone; the client sends only the code. Code limits of ADR-0014 (cooldown, hourly, IP send and verify). Nothing is said about orders that do not match both identifiers. Codes are never logged; logs carry the account id and the number of linked orders.

## Acceptance Criteria
- Claim sends a code only when at least one order matches phone and email; otherwise `404` and no email.
- Verify with the right code links exactly the matching orders, audits each, and leaves other guest orders and other customers' orders untouched.
- Wrong, reused or stale (email changed) codes link nothing.
- All required checks pass.

## Tests
- Unit `src/server/modules/auth/otp.test.ts`: the claim email exists in both languages.
- Integration `src/app/api/v1/me/me-routes.int.test.ts` ("guest order claim"): full flow with matching and non-matching orders, audit, single-use code, phone-only match refused, cooldown, wrong code, stale email, unauthenticated.

## Edge Cases
- Orders placed between claim and verify with the same phone and email are linked too.
- The account email changed after the code was sent: refused (`401 AUTH_OTP_INVALID`).
- Nothing left to claim: `404`.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- Resolved (owner decision 2026-10-18): not in v1; keep as is — no support-assisted linking of a guest order with another or missing email; customers use the email-code claim flow (R31, BD-020).
- Resolved (owner decision 2026-10-15): the customer is never told that orders exist under their phone with another email; every "nothing to claim" answer carries the same general hint `CONTACT_SUPPORT`.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
