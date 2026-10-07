# TASK-045 — Notification Service

## Goal

Customers and staff have an in-app notification centre with read/unread; transactional order messages leave after commit on WhatsApp with an email fallback only to an authorized address; every delivery attempt is logged; the COD request and reminders of TASK-031 are actually sent.

## Dependencies

TASK-005 (outbox, email port), TASK-007 (customer accounts), TASK-031 (COD events and `issueConfirmationToken`, ADR-0037).

## Source of Truth

- Business Spec Q53, Q55, Q56, Q57, Q58, Q61, Q63, R10, R14, R39; v1.1 §9 (marketing fallback, for later)
- User Flows §16.1
- Architecture §12
- DB Design §17, DB-6, "v1.2 TASK-045 Amendments"
- API Contract §11, "Staff notifications and delivery logs", "TASK-045 Amendments"

## Scope

- Tables `notifications`, `notification_deliveries` (migration `20261008045000_notifications`).
- `WhatsAppSender` port with a local `.json` transport (`WHATSAPP_DIR`); the existing `EmailSender` (ADR-0014).
- Templates (ar/en) for `ORDER_CREATED`, `COD_CONFIRMATION_REQUESTED`, `COD_CONFIRMATION_REMINDER`, `ORDER_COD_CONFIRMED`, `ORDER_CONFIRMED`, `ORDER_EXPIRED`; channel policy per template.
- Job `npm run jobs:dispatch-notifications`: claims outbox events, creates the in-app notification, sends with fallback, logs each attempt, retries with backoff.
- `GET /me/notifications`, `POST /me/notifications/{id}/read`, `POST /me/notifications/read-all`, `GET /admin/me/notifications`, `POST /admin/me/notifications/{id}/read`, `GET /admin/notifications/deliveries` (`NOTIFICATION_LOG_VIEW`).
- `createNotification(tx, …)` for staff/customer notifications from other modules.

## Non-Goals

- Marketing consent (TASK-046), marketing delivery and frequency (TASK-049), restock notifications and their channels (TASK-043), low-stock staff notifications (their own task), a real WhatsApp/email provider, job scheduling (TASK-066), UI, `/me/preferences` (see Open Items).

## Files / Modules

- `src/server/modules/notifications/` (`notifications-service.ts`, `templates.ts`, `schemas.ts`), `src/server/modules/orders/contacts.ts`
- `src/server/whatsapp/whatsapp.ts`, `src/server/config/env.ts` (`WHATSAPP_DIR`, `WEBSITE_URL`), `.env.example`, `.gitignore`, `vitest.integration.config.mts`
- `src/app/api/v1/me/notifications/**`, `src/app/api/v1/admin/me/notifications/**`, `src/app/api/v1/admin/notifications/deliveries/`
- `scripts/dispatch-notifications.ts`, `package.json`
- `prisma/schema.prisma`, `prisma/migrations/20261008045000_notifications/`
- Docs: ADR-0043, DB Design / API Contract "TASK-045 Amendments", roadmap

## Business Rules

- Q53: transactional messages cannot be switched off and are separate from marketing.
- Q55, Q56, Q61: WhatsApp primary, email fallback; every attempt and result logged.
- Fallback only to an authorized channel: a customer's verified email; a guest's checkout contacts; nothing for anonymized customers.
- R39, R10: COD request and reminders are WhatsApp only, each with its own secure link.
- Q57, Q58: deep links to orders; read/unread, mark one, mark all; history kept.
- Q63: channels come from the notification type (templates) — no customer setting for transactional messages.

## API Changes

API Contract "TASK-045 Amendments".

## Database Changes

Migration `20261008045000_notifications`. DB Design "v1.2 TASK-045 Amendments".

## Security / Authorization

Customer endpoints need an active customer session; staff endpoints an employee session; another owner's or a malformed id is `404`. The delivery log needs `NOTIFICATION_LOG_VIEW`; recipients are shown only with `VIEW_CUSTOMER_CONTACT`. Message text (which may hold a COD token) is never stored or logged; the token travels in the URL fragment.

## Acceptance Criteria

- An order event produces at most one in-app notification and one successful message, even if the job runs twice or crashes mid-way.
- WhatsApp failure falls back to email only when the email is authorized; otherwise the event retries with backoff and ends `FAILED` after 5 runs.
- COD messages carry a working link, never fall back to email, and are skipped once the order is no longer pending.
- Notification endpoints and the delivery log enforce ownership and permissions.
- All required checks pass.

## Tests

- Unit `src/server/modules/notifications/templates.test.ts`: both languages, COD link only in WhatsApp-only templates, channel eligibility.
- Integration `src/app/api/v1/me/notifications/notifications-routes.int.test.ts`: send and no resend, fallback, unverified email + retries + `FAILED`, guest COD link token, stale COD reminder, unhandled events untouched, customer centre, staff centre, delivery log permissions and masking.

## Edge Cases

- Customer deactivated after ordering: nothing is sent.
- Reminder event processed after confirmation or expiry: done without a message.
- Provider accepts a message but the run crashes before logging it: may be resent on the next claim (ADR-0043 consequences).

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] Which order events notify the customer, and the wording. Implemented: order received, COD request/reminder, COD confirmed, order accepted (`CONFIRMED`), order expired. Shipping/delivery/return/refund messages come with their tasks.
- [BUSINESS DECISION REQUIRED] Transactional retry policy: implemented as one try per channel per run, up to 5 runs at 5, 10, 15, 20 minutes (constants in `notifications-service.ts`). Q143 ("retry then email fallback") is decided for marketing only.
- [BUSINESS DECISION REQUIRED] Email fallback for the COD link: implemented as WhatsApp only (R39 says "WhatsApp channel"; the confirmation source enum has no email value). If the owner wants an email fallback, the source/channel values must be decided first.
- `/me/preferences` (API §11, TASK-009 note): not added. Language is already `PATCH /me`; restock channels are per subscription (TASK-043). TASK-043 or TASK-046 should decide whether a separate endpoint is still needed.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
