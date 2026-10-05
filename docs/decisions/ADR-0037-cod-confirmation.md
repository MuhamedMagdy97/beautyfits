# ADR-0037 — COD Confirmation, Reminders and Expiry

- **Status:** Accepted (TASK-031)
- **Date:** 2026-10-05
- **Relates to:** ADR-0036 (state machine), ADR-0035 (checkout), ADR-0025 (reservations), ADR-0034 (wallet holds), ADR-0031 (job script pattern); Business Spec Q18, Q24, Q25, Q27, Q31, Q54, R1, R10, R16, R21, R36, R39; User Flows §7; API §15 and "TASK-031 Amendments"; DB Design "Orders & COD" and "v1.2 TASK-031 Amendments"

## 1. The deadline is stored on the order

Checkout writes `cod_confirmation_deadline_at` = creation + `cod.confirmation_timeout_hours` (1–72, default 72) for every `PENDING_CONFIRMATION` order. Storing it makes "a later setting change applies to new orders only" (R39.2) hold without history lookups, and lets the jobs and the endpoints compare one column. A stored timeout above 72 hours is invalid and falls back to the default (settings pattern, ADR-0017).

## 2. Two confirmation paths, one System transition

`confirm-cod` (secure link, source `WHATSAPP`) and `record-phone-confirmation` (`RECORD_COD_CONFIRMATION`, source `PHONE`) share one function: lock the order, refuse when the deadline has passed (`ORDER_STATE_INVALID`, `reason = CONFIRMATION_DEADLINE_PASSED`), then `changeOrderStatus(→ NEW)` with the **System** as the history actor (R1) and the source, time and recording employee as lifecycle data. The audit entry names who confirmed (customer, SYSTEM for a guest, or the employee); the outbox gets `ORDER_COD_CONFIRMED`. Phone recording works on both channels.

## 3. Link tokens are issued at send time

Only token hashes are stored (ADR-0008), so the outbox cannot carry a usable link. Instead the WhatsApp sender (TASK-045) calls `issueConfirmationToken(orderId)` when it handles `COD_CONFIRMATION_REQUESTED` or `COD_CONFIRMATION_REMINDER`; each message gets its own `bfo_` token valid until the deadline. A used token answers again with the same body (retries of the link are harmless); any other token of a confirmed order is `ORDER_STATE_INVALID`. Unknown, malformed and foreign tokens are all `404` so the endpoint reveals nothing. 20 attempts per IP per hour, like checkout.

## 4. Jobs instead of a scheduler

As with guest carts (ADR-0031), `npm run jobs:send-cod-reminders` and `npm run jobs:expire-cod-orders` are idempotent scripts; TASK-066 schedules them every few minutes. Reminders: WhatsApp channel only, before the deadline, one interval after the request or the last reminder, up to the maximum; a conditional update on `cod_reminder_count` stops two runs from sending the same reminder. Expiry: one transaction per order re-locks it, skips it if it is no longer pending, moves it to `EXPIRED` (`expired_at`), and calls the existing idempotent `releaseForOrder`, `releaseDiscountUsage` and `releaseWalletReservation`, plus audit `ORDER_EXPIRED` and the `ORDER_EXPIRED` event. Between the deadline and the next run the endpoints already refuse, so a late confirmation can never win.

## Consequences

- No message leaves the system until TASK-045 adds the WhatsApp sender; until then the phone channel works end to end and the WhatsApp events wait in the outbox.
- Re-confirmation of material revisions (C5, TASK-032) adds `order_revision_id` to the tokens and reuses §2.
- Cancellation (TASK-033) reuses the same release calls.
