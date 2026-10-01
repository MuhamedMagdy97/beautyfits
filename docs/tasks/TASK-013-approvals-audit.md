# TASK-013 — Approval Requests & Audit Logs

## Goal
Important actions leave a permanent record of who did what, when, and what changed, which only the Owner and Admins can read and nobody can edit. Actions that need Owner/Admin approval can wait in a pending state until an Owner or Admin approves or rejects them.

## Dependencies
TASK-012 (roles, `requirePermission`), TASK-004 (bootstrap). Used by TASK-022 (purchase orders), TASK-023 (over-delivery), TASK-048 (campaigns), TASK-057 (settings, approvals and audit dashboard) and every task with audited actions.

## Source of Truth
- Business Spec Q70, Q76, Q79, Q113, Q116, Q142, Q180, Q181, R19, Audit Correction 7
- User Flows §17.3, §18
- Architecture §19, "Approval subsystem"
- Database Design §20, v1.1 `approval_requests`, "v1.2 TASK-013 Amendments"
- API Contract §25, §26, "TASK-013 Amendments"
- Security Requirements §8; Test Strategy invariants 13, 15; permission catalog §2
- ADR-0018 (this task)

## Scope
- Tables `audit_logs` (append-only, enforced by a database trigger) and `approval_requests` (migration `audit_logs_approvals`).
- `recordAudit` for writing entries inside the changing transaction; `GET /admin/audit-logs`.
- Audit entries for role and staff changes (TASK-012) and the bootstrap (TASK-004).
- Reusable approval mechanism: `requestApproval`, `cancelApprovalRequest`, handlers per approval type; `GET /admin/approval-requests`, `GET /admin/approval-requests/{id}`, `POST /admin/approval-requests/{id}/approve`, `POST /admin/approval-requests/{id}/reject`.

## Non-Goals
- Dashboard screens (TASK-057).
- The approval handlers of purchase orders, over-delivery, campaigns and critical settings (their tasks).
- `setting_history` and changing settings (TASK-057).
- Auditing customer or login events (not listed as important actions; later tasks add what they need).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261001165233_audit_logs_approvals/`
- `src/server/modules/audit/` (`audit.ts`, `schemas.ts`), `src/server/modules/approvals/` (`approvals.ts`, `handlers.ts`, `schemas.ts`)
- `src/app/api/v1/admin/audit-logs/route.ts`, `src/app/api/v1/admin/approval-requests/{,[id]/,[id]/approve/,[id]/reject/}route.ts`
- Audit writes in `src/server/modules/rbac/roles-service.ts`, `employees-service.ts`, `src/server/modules/bootstrap/bootstrap.ts`; request id passed by the admin routes and `requestMeta`

## Business Rules
- Q70: actor, action, entity, entity id, old/new value, timestamp; immutable from staff workflows.
- Q79: audit logs visible to Owner/Admin only (`VIEW_AUDIT_LOGS`).
- Audit Correction 7, User Flows §17.3, R19: persistent approval requests resolved by Owner/Admin (`APPROVAL_RESOLVE`); used in v1 for purchase orders, over-delivery extras, campaigns and critical settings; no order status approvals.
- Defaults where the documents are silent: ADR-0018 §4 (listed under Open Items).

## API Changes
API Contract "TASK-013 Amendments": shapes, filters, errors.

## Database Changes
Migration `audit_logs_approvals`. Database Design "v1.2 TASK-013 Amendments".

## Security / Authorization
Both endpoint groups are Owner/Admin-only permissions; a Manager role listing them grants nothing. Audit rows cannot be updated or deleted through any client. Snapshots contain no passwords, hashes, codes or tokens. Nobody resolves their own request.

## Acceptance Criteria
- Role, staff and bootstrap changes write an audit entry in the same transaction, with actor, before/after and the request id; refused or rolled-back changes write none.
- Updating or deleting an audit row fails.
- `GET /admin/audit-logs` filters by actor, action, entity and time; Owner/Admin only.
- A feature can open an approval request; only one is pending per type and entity.
- Owner/Admin approve (applying the feature's action in the same transaction) or reject with a reason; a resolved request cannot be resolved again; nobody resolves their own; the outcome is audited.
- All required checks pass.

## Tests
- Unit `src/server/modules/audit/audit.test.ts`: action codes, query and body schemas.
- Integration `src/server/modules/audit/audit.int.test.ts`: append-only trigger, rollback, search filters, audit entries of role and staff changes, no secrets.
- Integration `src/server/modules/approvals/approvals.int.test.ts`: request, duplicate and concurrent requests, approve/reject/cancel, self-resolution, handler refusal, missing handler, racing resolutions, listing.
- Integration `src/server/modules/bootstrap/bootstrap.int.test.ts`: seeded roles and Owner audited once.
- Route tests `src/app/api/v1/admin/approvals-audit-routes.int.test.ts`: 401/403, Owner/Admin-only, CSRF for cookies, list/detail/reject/approve errors, audit search and correlation id.

## Edge Cases
- Approve and reject at the same moment: one wins, the other gets `409`.
- The feature refuses the approval (entity changed): the request stays pending, nothing is audited.
- A request type whose feature has no handler yet cannot be approved (server error), but can be rejected.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
[BUSINESS DECISION REQUIRED] — safe defaults implemented (ADR-0018 §4), to be confirmed by the product owner:
1. Nobody approves or rejects their own request, Owner and Admin included.
2. A rejection must give a reason; an approval may.
3. Only one pending request per type and entity at a time.
4. Requests do not expire.
5. Only Owner/Admin see the approval list; requesters follow their request in their feature's screens.
6. Audit entries are kept forever and never edited; retention or redaction (e.g. customer anonymization, Q154) needs a later decision.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
