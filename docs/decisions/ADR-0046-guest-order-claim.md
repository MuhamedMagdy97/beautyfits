# ADR-0046 — Guest Order Claim

- **Status:** Accepted (TASK-010)
- **Date:** 2026-10-14
- **Relates to:** ADR-0014 (email OTP), ADR-0030 (profile changes), ADR-0035 (checkout), ADR-0036 (order core); Business Spec Q43, Q44, R16, R31; User Flows §3.5; DB Design "v1.2 TASK-010 Amendments"; API Contract §12 and "TASK-010 Amendments"

## Decision

- **Claimable order** (R31): `customer_id IS NULL`, `guest_phone` = the customer's phone and `guest_email` = the account email (both are stored normalized: E.164 and lower-case). A phone match alone never qualifies; guest orders with another or no email are linked by support.
- **Code destination:** the `guest_email` of the claimable orders. By the rule above it is always the account email, so one code covers every claimable order.
- `POST /guest/orders/claim` (ACTIVE customer) answers `404 NOT_FOUND` when nothing is claimable and sends no code. It never says whether orders exist under the phone with another email: the phone is not proven (R30), so that would leak another person's orders.
- `POST /guest/orders/claim/verify` consumes the code, then, in one transaction under the customer row lock, links every order claimable at that moment (orders placed between the two calls included) and writes one `ORDER_CLAIMED` audit entry per order. The code must have been sent to the current account email, else `AUTH_OTP_INVALID`.
- Reuses the profile-change OTP flow of ADR-0030 (`sendChangeCode` / `consumeChangeCode` in `profile-service.ts`): purpose `GUEST_ORDER_CLAIM`, 5 minutes, 5 attempts, 60 s resend cooldown, 5 codes per email per hour, IP send and verify limits (ADR-0014). Codes are never logged.
- An order is linked once and never moves: the `orders_immutable` trigger (TASK-030) lets `customer_id` change only from null. Order snapshots (contact, address, customer snapshot) are not rewritten.

## Consequences

- No migration: `otp_purpose` already has `GUEST_ORDER_CLAIM` and `audit_logs.action` is text.
- Once linked, the orders behave as the customer's own: `/me/orders`, cancellation, reviews and the R34 deactivation check see them.
- Support-assisted linking (R31) has no endpoint yet; see the open items of TASK-010.
