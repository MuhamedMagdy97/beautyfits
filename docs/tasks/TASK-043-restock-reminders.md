# TASK-043 — Restock / Notify Me & Wishlist Reminders

## Goal

Customers can explicitly ask to be told when an out-of-stock variant is back (Notify Me), on WhatsApp and/or email, and get exactly one message per restock. Wishlist items get purchase reminders with the R6 cadence, maximum, stop conditions and marketing-consent check.

## Dependencies

TASK-042 (wishlist, ADR-0041), TASK-045 (notification service, ADR-0043). TASK-046 (marketing consent ledger, ADR-0051): reminders read consent from its ledger.

## Source of Truth

- Business Spec Q20, Q47, Q51, Q52, Q59, Q60, Q61, Q62, R6, R12; v1.1 §8–9
- User Flows §4.2, §16.3
- Architecture §11, §12
- DB Design §15, "Wishlist reminder state", "v1.2 TASK-043 Amendments"
- API Contract §19, §31, "Wishlist reminders", "TASK-043 Amendments"

## Scope

- Table `restock_subscriptions`; R6 columns on `wishlist_items` (migration `20261014043000_restock_and_wishlist_reminders`).
- `GET/POST/DELETE /variants/{variantId}/restock-subscription`.
- Job `npm run jobs:notify-restocks`: fulfil subscriptions of variants back on sale, queue `RESTOCK_AVAILABLE`.
- Job `npm run jobs:send-wishlist-reminders`: R6 reminders, queue `WISHLIST_REMINDER`.
- Notification dispatcher: templates (ar/en) and recipients for both events; restock on the subscription's channels, reminders on consented channels only.
- Marketing consent lookup `marketingConsentChannels`, reading the TASK-046 ledger.

## Non-Goals

- Marketing consent ledger and `/me/marketing-consents` (TASK-046), marketing frequency limits (TASK-049), job scheduling (TASK-066), UI, `/me/preferences`.

## Files / Modules

- `src/server/modules/restock/` (`restock-service.ts`, `schemas.ts`), `src/server/modules/wishlist/reminders.ts`
- `src/server/modules/notifications/` (`notifications-service.ts`, `templates.ts`, `marketing-consent.ts`)
- `src/app/api/v1/variants/[variantId]/restock-subscription/`
- `scripts/notify-restocks.ts`, `scripts/send-wishlist-reminders.ts`, `package.json`
- `prisma/schema.prisma`, `prisma/migrations/20261014043000_restock_and_wishlist_reminders/`
- Docs: ADR-0050, API Contract / DB Design "TASK-043 Amendments", roadmap

## Business Rules

- Q51, Q47: Notify Me is a separate explicit subscription; wishlist membership never subscribes.
- R12: per variant, `POST`/`DELETE /variants/{variantId}/restock-subscription`.
- Q52: one notification per restock event, on the opted channels; a new restock needs a new subscription.
- Q62: restock preferences are separate from marketing (no marketing consent needed).
- R6: reminders every 3 days, at most 3 per item; stop on purchase, removal, unavailability/archive, loss of marketing consent; track last reminder, count and stop reason.
- Q59, v1.1 §9: marketing only with explicit consent; email fallback only with email marketing consent.

## API Changes

API Contract "TASK-043 Amendments" (adds `GET` on the subscription path).

## Database Changes

Migration `20261014043000_restock_and_wishlist_reminders`. DB Design "v1.2 TASK-043 Amendments".

## Security / Authorization

Customer session required; the customer comes from the session, never the request. Malformed or unknown variant ids are `404`. Message text is not stored (ADR-0043).

## Acceptance Criteria

- A customer subscribes to an out-of-stock variant on chosen channels, changes channels, reads and cancels the subscription.
- When the variant is back on sale, each active subscription gets one message on its channels only, in-app too; running the jobs again sends nothing more.
- Reminders follow R6: 3 days apart, at most 3, consented channels only, stop reasons recorded; nothing is sent without consent.
- All required checks pass.

## Tests

- Unit `src/server/modules/notifications/templates.test.ts`: restock/reminder templates in both languages, product link.
- Integration `src/app/api/v1/variants/[variantId]/restock-subscription/restock-routes.int.test.ts`: endpoint auth, validation, in-stock refusal, channel change and cancel; restock job once per subscription and per channel, unpurchasable variant waits; reminders without consent, cadence and maximum, unavailable, purchased (cancelled orders ignored), out of stock skipped, consent withdrawn before sending and after a reminder, item removed after queueing.

## Edge Cases

- Stock back and sold out between two job runs: not announced (ADR-0050 §1).
- Customer deactivated: restock subscription is closed by the job but nothing is sent; reminders skip the item.
- Consent withdrawn between queueing and sending: the dispatcher checks again and sends nothing.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- Resolved: marketing consent. TASK-046 merged first; `marketingConsentChannels` (`src/server/modules/notifications/marketing-consent.ts`) now returns the channels whose latest `marketing_consents` row is an opt-in.
- [BUSINESS DECISION REQUIRED] When the first reminder is due: implemented as 3 days after the item was added, then every 3 days (R6 gives the interval, not the start).
- [BUSINESS DECISION REQUIRED] What "purchased" means: implemented as an order by the customer containing the variant, created after the item was added, not `CANCELLED` or `EXPIRED`.
- [BUSINESS DECISION REQUIRED] Out-of-stock wishlist items: implemented as no reminder and not counted (Notify Me is the offer); R6 only names unavailable/archived as a stop.
- [BUSINESS DECISION REQUIRED] Consent: reminders stop for good (`NO_MARKETING_CONSENT`) when consent is gone after at least one reminder; an item whose customer never consented just waits. Decide whether re-consenting should restart stopped reminders.
- Resolved (owner decision 2026-10-15): with both channels chosen, a restock sends one message, WhatsApp first and email only as fallback (Q52, Q61).
- [BUSINESS DECISION REQUIRED] Notify Me is accepted only while the variant cannot be bought (Q20, Q47); in stock → `409 VARIANT_IN_STOCK`. Confirm.
- [BUSINESS DECISION REQUIRED] Message wording (ar/en) of the restock and reminder messages, and the product page link `WEBSITE_URL/products/{slug}`.
- `/me/preferences` (TASK-045 open item): not added; restock channels are per subscription and marketing preferences belong to TASK-046.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
