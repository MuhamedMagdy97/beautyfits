# ADR-0067 — Campaign Delivery: Consent Recheck, Frequency Limit, Retries and Email Fallback

- **Status:** Accepted (TASK-049)
- **Date:** 2026-10-17
- **Relates to:** ADR-0043 (notification service, delivery log, senders), ADR-0051 (consent ledger), ADR-0061 (campaign hand-off), ADR-0017/ADR-0054 (settings); Business Spec Q140, Q143, Q144, v1.1 §9; User Flows §16.2, §16.4, §16.5; Architecture §11; DB Design §18, "v1.2 TASK-049 Amendments"; API Contract §24, "TASK-049 Amendments"

## Context

TASK-048 ends at "send": a `SENDING` campaign with `PENDING` `campaign_recipients`. Delivery must recheck consent (an opt-out after send wins, §16.2), check that the address is deliverable (ADR-0051 §6), apply a configurable frequency limit (Q144), retry a failed WhatsApp message and then fall back to email only with email marketing consent (Q143, v1.1 §9), log every attempt, and end the campaign `COMPLETED` or `FAILED`. The documents give no numbers for the frequency limit or the retries.

## Decision

1. **A job, after commit.** `npm run jobs:deliver-campaigns` (`deliverPending` in `src/server/modules/marketing/delivery-service.ts`) handles up to 100 due recipients per run. Each recipient is claimed with a conditional update (`status = PENDING`, `attempt_count` unchanged) that increments `attempt_count` and sets a 15-minute lease in `next_attempt_at`, as the transactional dispatch does with outbox events (ADR-0043 §1). Nothing is sent inside a database transaction.
2. **Checks at delivery time, in order:** current consent to the campaign channel (latest ledger row) → `SKIPPED` / `CONSENT_WITHDRAWN`; deliverable address (WhatsApp: profile phone; email: verified account email; never an anonymized profile) → `SKIPPED` / `NO_ADDRESS`; frequency limit → `SKIPPED` / `FREQUENCY_LIMIT`. A skipped recipient gets no fallback.
3. **Frequency limit** = settings `marketing.frequency_max_messages` (0 = no limit) and `marketing.frequency_window_days`: a customer who already received that many campaign messages (`SENT`/`FALLBACK_SENT` with `sent_at` in the rolling window) is skipped. Only campaign messages count.
4. **Retries then fallback.** One try per run on the campaign channel; after a failure the recipient stays `PENDING` until `attempt × 5 minutes`. After `marketing.delivery_max_attempts` tries a WhatsApp campaign tries email once if the customer is opted in to email marketing and has a verified email (`FALLBACK_SENT`), else the recipient is `FAILED`. Email campaigns have no fallback.
5. **One delivery log.** Every try is a `notification_deliveries` row (template key `MARKETING_CAMPAIGN`) linked by the new `campaign_recipient_id`, numbered per recipient (`unique(campaign_recipient_id, attempt_number)`). The message body is not stored; the campaign holds it.
6. **Ending the campaign.** When a `SENDING` campaign has no `PENDING` recipient, the job locks it and moves it to `FAILED` if nothing was delivered and at least one recipient failed, otherwise `COMPLETED` (also when every recipient was skipped). The move is audited (`CAMPAIGN_COMPLETED` / `CAMPAIGN_FAILED`, actor `SYSTEM`, with the counts).
7. **Read side.** `GET /admin/campaigns/{id}/delivery` (`MARKETING_VIEW`) returns counts by recipient status, skip reason and channel attempt plus a page of recipients with their attempts, without contact data. The dashboard campaign page shows the counts.

## Consequences

- Migration `20261017049000_marketing_delivery`: enum `campaign_skip_reason`, recipient statuses `SKIPPED` and `FALLBACK_SENT`, recipient columns `attempt_count`, `next_attempt_at`, `skip_reason`, and `notification_deliveries.campaign_recipient_id`. No new dependency.
- At least once per try, as ADR-0043: a crash after the provider accepted a message but before the row was updated can resend it after the lease.
- Two runs delivering to the same customer at the same moment can pass the frequency limit by one message; acceptable at MVP volumes (no per-customer lock).
- `GET /admin/notifications/deliveries` also lists campaign attempts (no order id, no notification id).
- Frequency numbers, retry count, fallback subject and unsubscribe links await business decisions (TASK-049 open items); all numbers are settings.
