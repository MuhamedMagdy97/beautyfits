# ADR-0051 — Marketing Consent Ledger: Append-only Per-channel History

- **Status:** Accepted (TASK-046)
- **Date:** 2026-10-14
- **Relates to:** ADR-0043 (notification service), ADR-0018 (append-only audit); Business Spec Q53, Q59, Q60, Q154, Q155, R6, R34, R38.4, v1.1 §9; User Flows §16.2; Architecture §17; DB Design §3.4, "Marketing consent", "v1.2 TASK-046 Amendments"; API Contract "Marketing consent", "TASK-046 Amendments"

## Context

Marketing needs explicit opt-in per channel (Q59), email and WhatsApp independent (Q60), and must never be inferred from having an account, an email or a phone. DB Design already names one store, `marketing_consents`, holding the full opt-in/opt-out history, with the current state being the latest row per customer and channel. Segmentation (TASK-047), campaigns (TASK-048), marketing delivery and fallback (TASK-049) and wishlist reminders (R6) read it.

## Decision

1. **One append-only table.** Every change is a new `marketing_consents` row (`channel`, `purpose = MARKETING`, `status`, `source`, `occurred_at`). A trigger rejects UPDATE and DELETE, as for inventory movements and audit logs. There is no separate "current state" table to drift from the history.
2. **Current state = the row with the highest id per customer and channel.** The id is a `BIGSERIAL` (not a UUID like most tables): it increases with each insert, so ordering is exact even when two changes share a millisecond. Writers lock the customer row (`SELECT … FOR UPDATE`), so changes of one customer are serialized and id order is commit order. No row means not opted in (never pre-enabled).
3. **Only real changes are recorded.** A request that sets a channel to its current state adds no row, so the history is the list of actual opt-ins and opt-outs.
4. **Sources are set by the server, never the client:** `CUSTOMER_ACCOUNT` (`PATCH /me/marketing-consents`) and `ACCOUNT_DEACTIVATED` (system opt-out when the customer deactivates, R34). New sources (e.g. a campaign unsubscribe link in TASK-049) are added as enum values.
5. **The ledger is its own audit trail.** No `audit_logs` entry is written for consent changes: the append-only row already records who (the customer), what, when and from where; duplicating it adds nothing.
6. **Consent is per customer, not per address.** Changing the email or phone keeps the channel's consent (see the open item in the task file). Whether a message can actually be sent (verified email, a phone) is checked at delivery time by TASK-049, as ADR-0043 §3 does for transactional messages.
7. **Customers only.** Guests are never offered opt-in (R38.4); the table requires a `customer_id`.

`currentConsents(db, customerId)` and `recordConsentChanges(tx, …)` in `src/server/modules/customers/marketing-consents.ts` are the module's API for later tasks.

## Consequences

- History is kept indefinitely, also after deactivation (rows hold no personal data beyond the customer id). A retention period, if the owner sets one, needs a deliberate purge path that the trigger currently forbids.
- Segment queries take the latest row per channel (`DISTINCT ON (customer_id, channel) … ORDER BY id DESC`), served by the `(customer_id, channel, id)` index.
- Transactional notifications (ADR-0043) never read this table (Q53).
