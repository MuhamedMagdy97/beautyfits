# TASK-046 — Marketing Consent Ledger

## Goal

A registered customer explicitly opts in or out of email and WhatsApp marketing, separately; every change is kept in an append-only history with its time and source, and later marketing tasks can read who is currently opted in per channel.

## Dependencies

TASK-009 (customer profile, deactivation R34), TASK-045 (notification service; transactional messages stay independent of marketing consent).

## Source of Truth

- Business Spec Q53, Q59, Q60, Q154, Q155, R6, R34, R38.4; v1.1 §8–§9
- User Flows §16.2
- Architecture §17
- DB Design §3.4, "Marketing consent" (v1.2), "v1.2 TASK-046 Amendments"
- API Contract §11 note, "Marketing consent", "TASK-046 Amendments"
- Security Requirements (marketing consent never inferred, Q59/Q155); Test Strategy rule 10

## Scope

- Table `marketing_consents` (migration `20261014046000_marketing_consents`), append-only by trigger.
- `GET /me/marketing-consents`, `PATCH /me/marketing-consents` (`{ email?, whatsapp? }`).
- Deactivation (R34) appends an opt-out for every opted-in channel.
- Module API for TASK-047–TASK-049: `currentConsents`, `recordConsentChanges` (`src/server/modules/customers/marketing-consents.ts`).

## Non-Goals

- Segments (TASK-047), campaigns (TASK-048), marketing delivery, frequency, fallback and unsubscribe links (TASK-049), wishlist reminders (R6), staff view of a customer's consent, consent capture at registration, guest consent (R38.4: not offered), UI.

## Files / Modules

- `prisma/schema.prisma`, `prisma/migrations/20261014046000_marketing_consents/`
- `src/server/modules/customers/marketing-consents.ts`, `schemas.ts`, `profile-service.ts` (deactivation)
- `src/app/api/v1/me/marketing-consents/route.ts`
- Docs: ADR-0051, DB Design / API Contract "TASK-046 Amendments", roadmap

## Business Rules

- Q59: explicit opt-in; never pre-enabled; never inferred from having an account, email or phone (no row = not opted in).
- Q60: email and WhatsApp are independent; opting out of one leaves the other.
- Q53: transactional notifications do not read marketing consent.
- R38.4 / Q155: guests are not offered marketing opt-in; only customers have consent rows.
- R34: a deactivated (anonymized) customer is opted out of every channel; the history is kept.
- User Flows §16.2: opt-out immediately removes eligibility (the latest row is the state; no delay).

## API Changes

API Contract "TASK-046 Amendments".

## Database Changes

Migration `20261014046000_marketing_consents`. DB Design "v1.2 TASK-046 Amendments".

## Security / Authorization

Both endpoints need an `ACTIVE` customer session and act only on the signed-in customer (no id in the path). Input validated with zod (booleans only). The source is set by the server, never the client. History rows cannot be updated or deleted (database trigger). No contact data is stored in the ledger.

## Acceptance Criteria

- A new customer is opted out of both channels.
- Opting in/out per channel works, is independent per channel, and each real change appends one row with source and time; a no-op adds nothing.
- Concurrent identical requests add one row.
- UPDATE/DELETE on `marketing_consents` fail.
- Deactivation appends `OPTED_OUT` / `ACCOUNT_DEACTIVATED` for opted-in channels.
- All required checks pass.

## Tests

- Unit `src/server/modules/customers/schemas.test.ts`: request schema.
- Integration `src/app/api/v1/me/marketing-consents/marketing-consents-routes.int.test.ts`: auth, default state, per-channel opt-in/out and history, isolation between customers, validation, concurrency, append-only trigger.
- Integration `src/app/api/v1/me/me-routes.int.test.ts`: deactivation opt-out.

## Edge Cases

- Setting a channel to its current state: no row, `changedAt` unchanged.
- Two changes in the same millisecond: ordered by the `BIGSERIAL` id.
- Deactivated customer: its session no longer works, so the endpoints answer `401`.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- Resolved (owner decision 2026-10-18): keep current behaviour — consent history is kept indefinitely (BD-041).
- Resolved (owner decision 2026-10-18): keep current behaviour — consent belongs to the account and carries over after an email or phone change (BD-042).
- Resolved (owner decision 2026-10-18): keep current behaviour — no marketing checkbox at registration; customers opt in from their account (BD-043).
- Delivery eligibility (verified email, a phone) is checked when sending (TASK-049), not when consenting (ADR-0051 §6).
- `/me/preferences` (TASK-045 open item): not needed for marketing consent, which is `/me/marketing-consents` only (API §11). Still open for restock channels (TASK-043).

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
