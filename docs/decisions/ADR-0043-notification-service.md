# ADR-0043 — Notification Service: In-App Centre, Outbox Dispatch and Channel Fallback

- **Status:** Accepted (TASK-045)
- **Date:** 2026-10-08
- **Relates to:** ADR-0014 (email port), ADR-0031 (job script pattern), ADR-0037 (COD links issued at send time); Business Spec Q53, Q55–Q58, Q61, Q63, R10, R14, R39; User Flows §16.1; Architecture §12; DB Design §17 and "v1.2 TASK-045 Amendments"; API Contract "TASK-045 Amendments"

## 1. Messages leave after commit, from the outbox

Business modules already write outbox events inside their transactions (`ORDER_CREATED`, `COD_CONFIRMATION_REQUESTED`, …). `npm run jobs:dispatch-notifications` reads the due events whose type has a notification template and sends them; nothing in a business transaction waits for a provider (AGENTS.md, Business Spec Q22). Each event is claimed with a conditional update (`status`, `attempt_count` unchanged) and a 15-minute lease in `available_at`, so two runs never handle the same event and a crashed run's event is picked up again. The outbox has one consumer per event type; a second consumer of the same type (e.g. analytics) needs its own receipt table instead of the shared `status`.

## 2. One message per event, every attempt logged

For each event the service: creates the customer's in-app notification once (`notifications.source_event_id` is unique), stops if a delivery of that event already succeeded (so a re-claimed event never sends twice), then tries the template's channels in order. Every try is a `notification_deliveries` row (`PENDING` → `SENT` | `FAILED`, or `FALLBACK_SENT` for a later channel after a failure), numbered per event (`unique(source_event_id, attempt_number)`). The message text is never stored: it may hold a COD link.

If every eligible channel fails, the event goes back to `PENDING` after `attempt × 5 minutes`; after 5 runs it is `FAILED` with `last_error`. If no channel is eligible, or a COD order is no longer waiting for confirmation, the event is done without a message.

## 3. Channel policy lives in the templates (Q61, Q63)

Each template lists its channels in order: WhatsApp primary, email fallback (Q55, Q56, Q61). A channel is used only when the recipient has an authorized address for it: for customers the account email only once it is verified and the profile phone; for guests the contacts they gave at checkout. A deactivated (anonymized) customer gets nothing. Transactional messages cannot be switched off (Q53). The COD request and reminders are WhatsApp only (R39), with no email fallback, because the link's confirmation source is `WHATSAPP` (R10).

## 4. COD links are issued per message

The dispatcher calls `issueConfirmationToken` (ADR-0037 §3) for each COD message and sends `WEBSITE_URL/orders/{orderId}/confirm-cod#token=…`. The token is in the URL fragment, so it is not sent to the server or in `Referer` when the page loads; the page posts it to `confirm-cod`.

## 5. Providers are ports with local transports

Email keeps the `EmailSender` port (ADR-0014). WhatsApp gets the same shape, `WhatsAppSender`, whose only transport writes `.json` files to `WHATSAPP_DIR` (default `.whatsapp`), because no WhatsApp provider is chosen (Architecture §27). No dependency is added. A provider transport replaces it later without changing callers.

## Consequences

- Delivery is at least once per channel attempt: a crash after a provider accepted a message but before its row was updated can resend it on the next claim. Acceptable for transactional messages; webhooks/provider idempotency keys can close it when a provider is chosen.
- New transactional events (shipping, returns, refunds) only add a template.
- Staff notifications (low stock, Q110) use `createNotification` in their own transaction; the in-app centre and `/admin/me/notifications` already serve them.
- Marketing delivery (TASK-049) and restock notifications (TASK-043) reuse the delivery log and senders but add consent checks: marketing fallback only with marketing consent (Business Spec v1.1 §9).
