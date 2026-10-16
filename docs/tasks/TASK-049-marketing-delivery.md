# TASK-049 — Marketing Delivery, Frequency & Fallbacks

## Goal

Deliver the recipients of `SENDING` campaigns after the send hand-off (TASK-048): recheck consent and deliverability at delivery time, apply a configurable frequency limit, retry failures, fall back from WhatsApp to email only with email marketing consent, log every attempt, end the campaign `COMPLETED`/`FAILED`, and expose `GET /admin/campaigns/{id}/delivery`.

## Dependencies

TASK-048 (campaigns, ADR-0061), TASK-045 (notification service, delivery log, senders, ADR-0043), TASK-046 (consent ledger, ADR-0051). Scheduling of the job: TASK-066.

## Source of Truth

- Business Spec Q140, Q143 ("Retry then Email fallback; every attempt/failure is logged"), Q144 ("Yes, frequency limit; configurable"), Q59–Q61, v1.1 §9 (marketing fallback respects consent).
- User Flows §16.2 (opt-out immediately removes eligibility), §16.4 (delivery / failure logs), §16.5 (configurable frequency limits).
- Architecture §11 (campaign delivery is background work).
- DB Design §18, "v1.2 TASK-048 Amendments".
- API Contract §24 (`GET /admin/campaigns/{id}/delivery`, "Frequency limits are enforced server-side").
- ADR-0043 §2–§3 and Consequences, ADR-0051 §4/§6, ADR-0061 §6, ADR-0064.

## Scope

- Job `npm run jobs:deliver-campaigns` (`scripts/deliver-campaigns.ts`) → `deliverPending` in `src/server/modules/marketing/delivery-service.ts`.
- Per recipient at delivery time: consent recheck, deliverable address, frequency limit, one try per run, retry wait `attempt × 5 minutes`, email fallback for WhatsApp campaigns after the last try (consent + verified email).
- Recipient statuses `SKIPPED` (with `skip_reason`) and `FALLBACK_SENT`; claim/lease columns.
- Every try logged in `notification_deliveries` (new `campaign_recipient_id`).
- Campaign end `COMPLETED`/`FAILED` with a system audit entry (`CAMPAIGN_COMPLETED`, `CAMPAIGN_FAILED`).
- `GET /admin/campaigns/{id}/delivery` (`MARKETING_VIEW`): stats + recipients with attempts.
- Settings `marketing.frequency_max_messages`, `marketing.frequency_window_days`, `marketing.delivery_max_attempts` (editable in the dashboard settings screen).
- Dashboard: the campaign page shows delivery counts instead of the "not available yet" note (TASK-056 open item).

## Non-Goals

- Unsubscribe links in campaign messages and a public unsubscribe endpoint (see Open Items); customers opt out through `PATCH /me/marketing-consents`.
- Per-language content, WhatsApp templates, a real WhatsApp/email provider, provider webhooks.
- Counting wishlist reminders towards the frequency limit (see Open Items).
- Job scheduling (TASK-066), campaign cancellation (`CANCELLED` stays reserved).

## Files / Modules

- `prisma/schema.prisma`, `prisma/migrations/20261017049000_marketing_delivery/`
- `src/server/modules/marketing/delivery-service.ts` (new), `campaigns.ts` (`campaignOutcome`, system actor), `schemas.ts`
- `src/server/modules/settings/settings.ts`, `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/campaigns/[id]/delivery/route.ts` (new)
- `scripts/deliver-campaigns.ts`, `package.json`
- `src/app/staff/(shell)/marketing/[id]/page.tsx`, `src/app/staff/_lib/marketing-i18n.ts`, `src/app/staff/(shell)/_admin/kit.tsx`
- Tests: `src/server/modules/marketing/campaigns.test.ts`, `src/app/api/v1/admin/campaigns/campaign-delivery.int.test.ts`
- Docs: ADR-0067, API Contract "TASK-049 Amendments", DB Design "v1.2 TASK-049 Amendments", roadmap, permission catalog.

## Business Rules

- Recipients were opted in at send (Q140); consent is read again at delivery and an opt-out wins (§16.2). A skipped recipient gets no fallback.
- WhatsApp needs the profile phone; email needs the verified account email (ADR-0043 §3, ADR-0051 §6); a deactivated profile gets nothing.
- Frequency limit (Q144): campaign messages delivered (`SENT`/`FALLBACK_SENT`) to the customer in the rolling window; at the maximum the recipient is skipped.
- WhatsApp failure: retry, then email fallback only with email marketing consent (Q143, v1.1 §9). Every attempt and failure is logged.

## API Changes

`GET /admin/campaigns/{id}/delivery` (API Contract "TASK-049 Amendments"). Campaign tries also appear in `GET /admin/notifications/deliveries`.

## Database Changes

Migration `20261017049000_marketing_delivery` (DB Design "v1.2 TASK-049 Amendments"): enum `campaign_skip_reason`; `campaign_recipient_status` + `SKIPPED`, `FALLBACK_SENT`; `campaign_recipients.attempt_count`, `next_attempt_at`, `skip_reason`; `notification_deliveries.campaign_recipient_id` + unique `(campaign_recipient_id, attempt_number)`. New settings rows are created by the bootstrap with their defaults.

## Security / Authorization

- The delivery endpoint needs `MARKETING_VIEW` and returns customer ids only, no phone or email. The delivery log keeps addresses as before (`recipient` only with `VIEW_CUSTOMER_CONTACT`).
- No message body is stored in the log; provider failure text is trimmed to one line.
- The job runs server-side only; consent and addresses are never taken from a client.

## Acceptance Criteria

- [x] An opt-out after send skips the recipient (`CONSENT_WITHDRAWN`); no address skips it (`NO_ADDRESS`).
- [x] The frequency limit skips recipients at the maximum (`FREQUENCY_LIMIT`) and is off with the default 0.
- [x] Failed tries are retried after `attempt × 5 minutes` up to the configured maximum; WhatsApp then falls back to email only with email consent and a verified email.
- [x] Every try is a delivery row numbered per recipient.
- [x] Campaigns end `COMPLETED` or `FAILED` with a system audit entry; a re-run sends nothing twice.
- [x] `GET /admin/campaigns/{id}/delivery` returns stats and recipients; 403/404/400 as documented.

## Tests

- Unit: `campaignOutcome`, delivery query schema.
- Integration (`campaign-delivery.int.test.ts`): consent recheck + no address + completion audit + idempotent re-run; WhatsApp retry wait, fallback with consent, failure without; all failed → `FAILED`; frequency limit default off / on with window; non-`SENDING` campaigns untouched; endpoint stats, filter, no contact data, permission/404/400.

## Edge Cases

- Crash mid-try: the lease (15 minutes) makes the recipient re-claimable; the attempt counter already moved, so a crash uses up one try. A message accepted by the provider just before a crash can be sent twice (as ADR-0043).
- Two runs at once: each recipient is claimed by one; the frequency limit can be passed by one message for the same customer.
- Every recipient skipped: the campaign is `COMPLETED` with zero sent.
- WhatsApp consent withdrawn but email consent present: skipped, no fallback (the opt-out wins; fallback is only for failed sends).

## Open Items

- [BUSINESS DECISION REQUIRED] Frequency limit numbers (Q144 says only "configurable"): maximum messages and window. Implemented as settings `marketing.frequency_max_messages` (default **0 = no limit**) and `marketing.frequency_window_days` (provisional 7). Until the owner sets a maximum, no limit applies.
- [BUSINESS DECISION REQUIRED] Retry count and spacing (Q143 says "retry then email fallback"): setting `marketing.delivery_max_attempts`, provisional default 5 with `attempt × 5 minutes` waits, taken from the transactional dispatch (ADR-0043 §2).
- [BUSINESS DECISION REQUIRED] Email fallback subject for WhatsApp campaigns (they have no subject): provisional fixed subject "BeautyFits".
- [BUSINESS DECISION REQUIRED] Unsubscribe links (mentioned for TASK-049 by TASK-046/ADR-0051 §4, not in the API contract): should campaign messages carry a one-click unsubscribe link (a public token endpoint and consent source `CAMPAIGN_UNSUBSCRIBE`)? Not implemented; opt-out is through the account.
- [BUSINESS DECISION REQUIRED] Do wishlist purchase reminders (R6, marketing-style) count towards the marketing frequency limit? Currently only campaign messages count.
- Email campaigns have no WhatsApp fallback: Q143 defines the fallback only for WhatsApp failures.
- Campaign outcome: `FAILED` only when nothing was delivered and at least one recipient failed; otherwise `COMPLETED` (ADR-0067 §6). Confirm if the owner wants a different threshold.

## Definition of Done

Acceptance criteria met; lint, format, typecheck, unit and integration tests and build pass; docs updated; committed on `feature/TASK-049-marketing-delivery`.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
