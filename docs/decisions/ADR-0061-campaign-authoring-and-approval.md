# ADR-0061 — Campaign Authoring, Approval and the Hand-off to Delivery

- **Status:** Accepted (TASK-048)
- **Date:** 2026-10-16
- **Relates to:** ADR-0018 (approval requests), ADR-0027 (purchase orders, same approval pattern), ADR-0051 (consent ledger), ADR-0057 (segments); Business Spec Q13, Q139, Q140, Q142, R19; User Flows §16.4; Architecture §17; DB Design §18, "v1.2 TASK-048 Amendments"; API Contract §24, "TASK-048 Amendments"

## Context

Campaigns are prepared by marketing staff and sent only after Owner/Admin approval; nothing is sent automatically (Q13, Q139, Q142). R19 names marketing campaigns as a user of the approval-request mechanism. Recipients must be opted in (Q140), and delivery with frequency limits, retries and email fallback is a separate task (TASK-049).

## Decision

1. **Module `src/server/modules/marketing/`, tables `campaigns` and `campaign_recipients`.** Lifecycle `DRAFT → PENDING_APPROVAL → APPROVED → SENDING → COMPLETED | FAILED` in one transition table (`CAMPAIGN_TRANSITIONS`); every move locks the campaign row and writes an audit entry in its transaction. Rows are never deleted (triggers).
2. **The audience is a TASK-047 segment definition** stored on the campaign (`segment_json`); the campaign's channel is the segment's channel (check constraint). Content is one plain-text body plus a subject for email.
3. **Approval uses approval requests (ADR-0018), as purchase orders do (ADR-0027).** Submitting opens a `MARKETING_CAMPAIGN` request; its handler (`campaigns.ts`, registered in `approvals/handlers.ts` through a getter) applies the result, so `/admin/campaigns/{id}/approve|reject` and `/admin/approval-requests/{id}/approve|reject` agree. Approving needs `MARKETING_APPROVE` (Owner/Admin only); the generic rule that nobody resolves their own request applies. Unlike purchase orders, there is no approve-on-submit for Owner/Admin: no business decision allows it (open item).
4. **A rejection returns the campaign to `DRAFT`** (the status list has no `REJECTED`); the reason stays on the approval request and in the history.
5. **Only drafts change**, so the approved content and audience are what is sent.
6. **"Send" is the hand-off.** It moves `APPROVED → SENDING` and resolves the segment at that moment into `PENDING` `campaign_recipients` rows, each with the consent ledger row that made the customer eligible. No message, job or outbox event is created: TASK-049 picks up `SENDING` campaigns, rechecks consent at delivery (an opt-out after send must still win, User Flows §16.2), applies frequency limits and fallback and ends the campaign. An empty audience is refused (`CAMPAIGN_AUDIENCE_EMPTY`).
7. **History** is the campaign's audit entries, returned with the campaign; no separate history table.

## Consequences

- Migration `20261016048000_campaigns` (two tables, two enums, a check and two triggers). No new dependency.
- Resolving recipients loads all ids in one transaction; fine at MVP audience sizes.
- TASK-049 owns recipient statuses beyond `PENDING`/`SENT`/`FAILED`, the delivery endpoint and the `COMPLETED`/`FAILED` moves.
