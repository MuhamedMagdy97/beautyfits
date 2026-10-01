# ADR-0018 — Audit logs and approval requests

- **Status:** Accepted (TASK-013); the defaults in §4 await product-owner confirmation
- **Date:** 2026-10-01
- **Relates to:** ADR-0010 (transactions), ADR-0016 (roles), ADR-0017 (bootstrap); Business Spec Q70, Q76, Q79, Q113, Q116, Q142, Q180, Q181, R19, Audit Correction 7; User Flows §17.3, §18; Architecture §19 and "Approval subsystem"; DB Design §20, v1.1 `approval_requests` and "v1.2 TASK-013 Amendments"; API Contract §25, §26 and "TASK-013 Amendments"; Security Requirements §8; Test Strategy invariant 15

Until now role, staff and bootstrap changes went only to the structured logger (ADR-0016, ADR-0017), and nothing could hold an action until an Owner/Admin approved it. Later tasks (purchase orders, receiving, campaigns, settings) need both.

## 1. Audit logs

- Table `audit_logs` as designed in DB §20 (`entity_id` is text). Module `src/server/modules/audit/audit.ts`.
- **Same transaction.** `recordAudit(tx, entry)` is called with the transaction that makes the change, so a change never commits without its entry and a rolled-back or refused change leaves none.
- **Append-only in the database.** A trigger rejects every `UPDATE` and `DELETE` on `audit_logs`, whichever client or user runs it (Q70 "immutable from normal staff workflows", Test Strategy invariant 15). No endpoint changes or deletes an entry. `TRUNCATE` is not blocked; only the integration test reset uses it.
- **Actor:** `EMPLOYEE` + employee id for staff actions, `SYSTEM` for the bootstrap, `CUSTOMER` + customer id later. The accepted invitation is recorded with the new employee as actor.
- **Correlation id:** the API request id (`X-Request-Id`), so an entry can be matched with the request's log lines. Services take it as an optional last argument or through `RequestMeta.requestId`.
- **Action codes** are listed in `AUDIT_ACTIONS`; later tasks add theirs and never rename one.
- **Snapshots** hold only what a reviewer needs to see the change (names, levels, role ids, permission codes, status). Never passwords, password hashes, codes or tokens. An employee edit that changes nothing and a repeated deactivation write no entry.
- **Now audited:** `ROLE_CREATED`, `ROLE_UPDATED`, `EMPLOYEE_INVITED`, `EMPLOYEE_INVITATION_REVOKED`, `EMPLOYEE_INVITATION_ACCEPTED`, `EMPLOYEE_UPDATED`, `EMPLOYEE_DEACTIVATED` (TASK-012), `ROLE_SEEDED` and `OWNER_BOOTSTRAPPED` (TASK-004; replaces the "until audit_logs exists" notes of ADR-0016 and ADR-0017), and the approval events below. The logger lines stay.
- **Search:** `GET /admin/audit-logs` (`VIEW_AUDIT_LOGS`, Owner/Admin only, Q79), filters by actor, action, entity and time window, newest first.

## 2. Approval requests

- Table `approval_requests` as designed (v1.1), plus `resolution_reason`. `approval_type` is an enum of the four uses of R19. Module `src/server/modules/approvals/`.
- **Created by features, not by an endpoint.** A feature calls `requestApproval(tx, …)` in the transaction that puts its entity into a pending state (for example a purchase order in `PENDING_APPROVAL`) and stores in `metadata` what will happen on approval.
- **Resolved through the API.** `POST /admin/approval-requests/{id}/approve|reject` (`APPROVAL_RESOLVE`, Owner/Admin only, User Flows §17.3). The request row is locked, must be `PENDING`, and changes status in the same transaction in which the feature's **handler** applies the outcome. If the handler refuses (throws), everything rolls back and the request stays `PENDING`. Two resolutions at once: the second gets `409`.
- **Handlers** are listed in `src/server/modules/approvals/handlers.ts`, one per approval type, added by the task that first creates that type (TASK-022, TASK-023, TASK-048, TASK-057). Approving a type with no handler fails with a server error, so nothing is approved before its feature knows how to apply it. Rejecting needs no handler.
- **Cancellation:** `cancelApprovalRequest(tx, …)` lets a feature withdraw a pending request (for example when the purchase order is cancelled). The feature decides who may do it; there is no endpoint (none in the API contract).
- Every request, approval, rejection and cancellation writes an audit entry (`APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`). The handler audits the applied action itself.

## 3. Out of scope

- Dashboard screens (TASK-057).
- Approval handlers and the pending states of purchase orders, over-delivery, campaigns and settings (their tasks).
- `setting_history` and settings changes (TASK-057).
- Customer anonymization (Q154) of personal data inside audit snapshots: no customer action is audited yet; the task that adds the first one must keep customer personal data out of snapshots or define how it is redacted (§4 item 6).

## 4. Defaults where the documents are silent ([BUSINESS DECISION REQUIRED] for confirmation)

1. **Nobody approves or rejects their own request, Owner and Admin included** ("four eyes"). Whether an Owner/Admin's own change needs a request at all (for example a critical setting changed by the Owner) is decided by each feature task; if it does, a single Owner cannot approve it alone.
2. **A rejection must give a reason; an approval may.** The reason is stored on the request and in the audit entry.
3. **Only one pending request per type and entity.** A second one is refused until the first is resolved or cancelled.
4. **Requests do not expire.** They stay pending until resolved or cancelled.
5. **Only Owner/Admin see the approval list** (`APPROVAL_RESOLVE`, as in API §25). Requesters see the state of their request through their feature's own screens.
6. **Audit entries are kept forever** and are never edited, even by the Owner. Retention or redaction (for example on customer anonymization, Q154) needs a later decision.

## Consequences

- New migration `audit_logs_approvals` (two tables, three enums, the append-only trigger).
- Services in `rbac` and `bootstrap` now write audit entries inside their transactions; routes pass the request id.
- No new dependency.
