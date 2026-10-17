# TASK-048 — Campaign Authoring & Approval

## Goal

Marketing staff draft a campaign (channel, segment, content), submit it, and an Owner/Admin approves or rejects it before it can be sent; sending fixes the opted-in recipients for the delivery task. Lifecycle Draft → Pending Approval → Approved → Sending → Completed/Failed.

## Dependencies

TASK-013 (approval requests, audit), TASK-046 (consent ledger), TASK-047 (segments).

## Source of Truth

- Business Spec Q13, Q139, Q140, Q141, Q142, R19
- User Flows §16.4 (new-product campaign), §16.2 (opt-out)
- Architecture §17 (marketing architecture)
- DB Design §18 (`campaigns`, `campaign_recipients`), "v1.2 TASK-048 Amendments"
- API Contract §24, "TASK-013 Amendments", "TASK-047 Amendments", "TASK-048 Amendments"
- Permission catalog (`MARKETING_*`, Owner/Admin-only `MARKETING_APPROVE`); Security Requirements; Test Strategy
- ADR-0018, ADR-0027, ADR-0051, ADR-0057, ADR-0061

## Scope

- Tables `campaigns`, `campaign_recipients` (migration `20261016048000_campaigns`).
- `GET/POST /admin/campaigns`, `GET/PATCH /admin/campaigns/{id}`, `POST /admin/campaigns/{id}/submit|approve|reject|send`.
- `MARKETING_CAMPAIGN` approval handler; audit entries and history for every change.

## Non-Goals

- Delivering messages, frequency limits, retries, email fallback, delivery logs and `GET /admin/campaigns/{id}/delivery` (TASK-049).
- Campaign suggestions when a product is published (User Flows §16.4), cancelling campaigns, scheduling, dashboard screens (TASK-056).

## Files / Modules

- `src/server/modules/marketing/campaigns.ts` (transitions, approval handler), `campaigns-service.ts`, `schemas.ts`, `campaigns.test.ts`
- `src/server/modules/approvals/handlers.ts` (handler getter), `src/server/modules/audit/audit.ts` (actions, entity type)
- `src/app/api/v1/admin/campaigns/**`, `campaigns-routes.int.test.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261016048000_campaigns`
- Docs: ADR-0061, API Contract, DB Design, permission catalog, roadmap

## Business Rules

- Q13/Q139: marketing-authorized staff prepare; no automatic sending (send is an explicit staff action).
- Q142/R19: Owner/Admin final approval through an approval request; `MARKETING_APPROVE` is Owner/Admin only. Nobody resolves their own request (ADR-0018).
- Q140: recipients are the segment's customers opted in to the channel at send time (ADR-0057).
- Only drafts change; a rejection returns to `DRAFT` with the reason.

## API Changes

API Contract "TASK-048 Amendments".

## Database Changes

DB Design "v1.2 TASK-048 Amendments".

## Security / Authorization

Employee session; permissions checked server-side per endpoint (`MARKETING_VIEW`, `MARKETING_CREATE`, `MARKETING_EDIT`, `MARKETING_APPROVE`, `MARKETING_SEND`). Inputs validated with zod. No customer data is returned (only a recipient count). Every change is audited in its transaction; campaigns and recipients cannot be deleted.

## Acceptance Criteria

- Draft create/edit, submit, approve/reject, send work with the right statuses; illegal moves give `409 CAMPAIGN_STATUS_INVALID`.
- Approval only by an Owner/Admin who did not submit; same outcome through the approval queue.
- Send writes one `PENDING` recipient per opted-in customer and sends nothing; empty audience refused.
- `401`/`403` without session/permission; `400` for invalid input.
- All required checks pass.

## Tests

- Unit `src/server/modules/marketing/campaigns.test.ts`: transition table, schemas.
- Integration `src/app/api/v1/admin/campaigns/campaigns-routes.int.test.ts`: authoring, subject/channel, permissions (incl. a Manager role holding `MARKETING_APPROVE`), full lifecycle with consent filtering, self-approval, rejection and resubmit, approval queue path, empty audience, no delete.

## Edge Cases

- Opted in then out before send: not a recipient. Opt-out after send: TASK-049 rechecks consent.
- Changing the segment's channel on a draft changes the campaign channel; the subject must fit it.
- A second submit while pending: `409` (status), the approval request stays single.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- Resolved (owner decision 2026-10-18): keep current behaviour — an Owner/Admin's own campaign needs a second Owner/Admin to approve; no auto-approve (BD-049).
- Resolved (owner decision 2026-10-18): keep current behaviour — rejected campaigns return to `DRAFT` (BD-050).
- Resolved (owner decision 2026-10-18): not in v1; keep as is — no campaign cancel function (BD-051).
- Resolved (owner decision 2026-10-18): keep current behaviour — one plain-text body per campaign (BD-052). Pre-approved WhatsApp templates: Deferred (owner 2026-10-18): localhost only for now (provider choice).
- Technical defaults (not business rules): name/subject ≤ 200, content ≤ 10000 characters; email requires a subject, WhatsApp has none; send with no opted-in recipient is refused.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [x] Reviewed
- [x] Done
