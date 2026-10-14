# ADR-0050 — Restock Notify Me and Wishlist Purchase Reminders

- **Status:** Accepted (TASK-043)
- **Date:** 2026-10-14
- **Relates to:** ADR-0041 (wishlist), ADR-0043 (notification service), ADR-0024 (inventory ledger); Business Spec Q20, Q47, Q51, Q52, Q59, Q61, Q62, R6, R12; User Flows §4.2, §16.3; DB Design §15 and "v1.2 TASK-043 Amendments"; API Contract §19 and "TASK-043 Amendments"

## 1. A restock event is detected by a job, not by inventory code

Available stock changes only through `inventory_movements` triggers (ADR-0024), from many places: goods receipts, return restocks, adjustments, released reservations. Instead of hooking each of them, `npm run jobs:notify-restocks` runs one statement: close (`FULFILLED`) every active subscription whose variant is purchasable (product published, variant active, priced, `available_quantity > 0`), returning the ids, and write one `RESTOCK_AVAILABLE` outbox event per id in the same transaction. The update re-checks `status = 'ACTIVE'` under the row lock, so two runs never notify twice. Closing the subscription is what makes it one message per restock event (Q52); another one needs a new subscription.

Subscribing is only possible while the variant cannot be bought (Notify Me is the out-of-stock offer, Q20, Q47); otherwise the job would fire at once.

Consequence: stock that comes back and sells out between two runs is not announced. Run the job every few minutes (TASK-066).

## 2. Restock channels belong to the subscription

Restock is its own preference, separate from marketing (Q62), so it needs no marketing consent. The customer picks WhatsApp, email or both per subscription (User Flows §16.3); `/me/preferences` is not added. The dispatcher (ADR-0043) sends WhatsApp first, then email as fallback, but only among the chosen channels, and adds an in-app `RESTOCK` notification linking to the product.

## 3. Wishlist reminders: state on the item, message through the outbox

`npm run jobs:send-wishlist-reminders` walks items whose reminder is due (3 days after adding or after the last reminder, R6). Per item, in order: variant unsellable → stop `UNAVAILABLE`; ordered since it was added (order not cancelled or expired) → stop `PURCHASED`; out of stock → wait (not counted); no marketing consent → stop `NO_MARKETING_CONSENT` if a reminder was already sent, else wait; otherwise increment `reminder_count`, set `last_reminded_at` (and `MAX_REMINDERS` at the third) and write a `WISHLIST_REMINDER` outbox event, in one transaction guarded by the old count. Removal deletes the item, so the dispatcher finds nothing and sends nothing.

The dispatcher checks consent again when sending and uses only consented channels (email fallback only with email marketing consent, v1.1 §9). No in-app copy: in-app is not a consented marketing channel.

## 4. Marketing consent comes from the TASK-046 ledger

`marketingConsentChannels(db, customerId)` in `src/server/modules/notifications/marketing-consent.ts` returns the channels with valid marketing consent. It reads the consent ledger (TASK-046, ADR-0051): a channel counts only while its latest row is an opt-in, and no row means no consent (Q59). The services also take it as a dependency so tests can supply consent.

## Consequences

- Both jobs only queue events; delivery, retries and the delivery log are ADR-0043's.
- Items that never get consent are re-read on every reminder run; fine at MVP scale, add an index or a skip marker if it grows.
- Changing the cadence or maximum is a constant change (`REMINDER_INTERVAL_MS`, `MAX_REMINDERS`), as R6 fixes them.
