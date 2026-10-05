# TASK-031 — COD Confirmation

## Goal

A COD order waiting for confirmation is confirmed by the customer (WhatsApp secure link) or recorded by staff (phone), and the System moves it to New; unconfirmed orders get reminders and expire at their deadline, giving their stock, discount use and wallet credit back.

## Dependencies

TASK-030 (state machine, ADR-0036), TASK-029 (checkout), TASK-020/026/028 (release helpers). TASK-045 later adds the WhatsApp sender.

## Source of Truth

- Business Spec Q18, Q24, Q25, Q27, Q31, Q54, R1, R10, R16, R21, R36, R39
- User Flows §7, §8
- DB Design "Orders & COD", "v1.2 TASK-031 Amendments"
- API Contract §15, "TASK-031 Amendments"

## Scope

- Order deadline fixed at checkout from the timeout setting; `COD_CONFIRMATION_REQUESTED` event on the WhatsApp channel.
- `POST /orders/{orderId}/confirm-cod` (secure token, rate limited) and `POST /admin/orders/{orderId}/record-phone-confirmation` (`RECORD_COD_CONFIRMATION`); System `PENDING_CONFIRMATION → NEW`, audit and `ORDER_COD_CONFIRMED` event.
- `issueConfirmationToken` for the future WhatsApp sender.
- Jobs `jobs:send-cod-reminders` and `jobs:expire-cod-orders`.
- Settings: timeout, reminder interval and maximum, channel.

## Non-Goals

- Sending WhatsApp messages (TASK-045), job scheduling (TASK-066), settings screen (TASK-057), revision re-confirmation (TASK-032), cancellation (TASK-033), UI.

## Files / Modules

- `src/server/modules/orders/cod-service.ts`, `orders-service.ts` (admin view), `schemas.ts`
- `src/server/modules/checkout/checkout-service.ts`, `src/server/modules/settings/settings.ts`, `src/server/modules/auth/tokens.ts`, `src/server/modules/audit/audit.ts`
- `src/app/api/v1/orders/[orderId]/confirm-cod/`, `src/app/api/v1/admin/orders/[orderId]/record-phone-confirmation/`
- `scripts/send-cod-reminders.ts`, `scripts/expire-cod-orders.ts`, `package.json`
- `prisma/migrations/*_cod_confirmation/`, `prisma/schema.prisma`
- Docs: ADR-0037, Business Spec R39, DB Design / API Contract "TASK-031 Amendments"

## Business Rules

- R1, R10: only the System moves `Pending Confirmation → New`; source `WHATSAPP` or `PHONE` with the recording employee.
- Q25, R21, R39: 72-hour default deadline, never more, fixed per order; expiry at the deadline releases stock, discount use and wallet credit (Q31, R36).
- Q54, R39: reminders every 24 hours, at most 2, WhatsApp channel only.
- R16: the link only confirms.

## API Changes

API Contract "TASK-031 Amendments".

## Database Changes

Migration `cod_confirmation`. DB Design "v1.2 TASK-031 Amendments".

## Security / Authorization

Link tokens are 256-bit, stored hashed, bound to one order and valid until its deadline; failures are a uniform `404`; 20 attempts per IP per hour. Phone recording needs `RECORD_COD_CONFIRMATION` and is audited. Logs carry ids only, never tokens.

## Acceptance Criteria

- Checkout stores the deadline from the setting (max 72 h) and queues the request only on the WhatsApp channel.
- A valid link confirms the order once (retries answer the same); wrong, foreign or malformed tokens are `404`; after the deadline both paths are refused.
- Phone recording needs the permission and stores the employee; history shows the System.
- Reminders follow the interval and maximum and stop at the deadline or confirmation.
- Expiry moves due orders to `EXPIRED` once, releasing stock, discount use and wallet hold; confirmed orders are untouched.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/orders/cod-routes.int.test.ts`: deadline and channel at checkout, link confirmation (customer, guest, retry, wrong tokens, deadline, rate limit), phone recording (permission, audit, twice, deadline), reminders, expiry.
- Unit/integration bootstrap tests: the new setting defaults and validity.

## Edge Cases

- Timeout setting changed after ordering: existing deadlines stay.
- Confirmation after the deadline but before the expiry job: refused.
- Two job runs at once: the reminder count guard and the order lock keep each action single.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- None. Owner decisions of 2026-10-05 are recorded as Business Spec R39.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
