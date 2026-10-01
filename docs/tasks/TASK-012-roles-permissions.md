# TASK-012 — Roles, Granular Permissions & Employee Invitations

## Goal
The backend decides what every staff member may do. Owner and Admin can do everything; Managers and Employees can do what their roles allow. Owner, Admins and Managers invite new staff by work email within the hierarchy, edit their level and roles, and deactivate them without deleting history. The invitee accepts the invitation by choosing a password.

## Dependencies
TASK-011 (employee login, `requireEmployee`). Followed by TASK-013 (approval requests, audit logs) and TASK-004 (first Owner and default roles).

## Source of Truth
- Business Spec Q64–Q69, R15, R17, R18, R28
- User Flows §2, §17
- Architecture §6
- Database Design §4, "v1.2 TASK-002A Amendments" (`employee_invitations`), "v1.2 TASK-012 Amendments"
- API Contract §6.1, §10, §25, "TASK-012 Amendments"
- `docs/security/permission-catalog.md`, Security Requirements §5
- ADR-0015; ADR-0016 (this task)

## Scope
- Tables `roles`, `permissions` (with the catalog rows), `role_permissions`, `employee_roles`, `employee_invitations` (migration `roles_permissions`).
- Effective permissions (Owner/Admin: all; others: roles minus the Owner/Admin-only permissions) and `requirePermission` / `requireStaff` guards.
- `GET /admin/permissions`, `GET/POST /admin/roles`, `PATCH /admin/roles/{id}`.
- `GET/POST /admin/employees`, `PATCH /admin/employees/{id}`, `POST /admin/employees/{id}/deactivate`, `GET /admin/employees/invitations` (new), `POST /admin/employees/invitations/{id}/revoke`.
- `POST /employee-auth/accept-invitation` (moved here from TASK-011).
- `GET /employee-auth/session` returns the effective permissions.
- Bilingual invitation email with a dashboard link; `DASHBOARD_URL` setting.

## Non-Goals
- The first Owner and the default roles of catalog §3 (TASK-004 seed).
- `audit_logs` and approval requests (TASK-013): events go to the structured logger for now.
- Dashboard screens, including the accept-invitation page (TASK-052 onward).
- Ownership transfer, reactivating a deactivated employee, deleting roles (no endpoint in the API contract).
- Permission checks of feature endpoints that do not exist yet (each feature task uses `requirePermission`).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261001153735_roles_permissions/`
- `src/server/modules/rbac/`: `catalog.ts`, `authorization.ts`, `hierarchy.ts`, `roles-service.ts`, `employees-service.ts`, `invitation-email.ts`, `schemas.ts`, `http.ts`
- `src/app/api/v1/admin/{permissions,roles,roles/[id],employees,employees/[id],employees/[id]/deactivate,employees/invitations,employees/invitations/[id]/revoke}/route.ts`
- `src/app/api/v1/employee-auth/accept-invitation/route.ts`; `employee-auth/session/route.ts` (permissions)
- `src/server/modules/auth/tokens.ts` (`bfi_` invitation token), `src/server/config/env.ts` (`DASHBOARD_URL`), `src/test/integration/database.ts` (keeps the catalog rows)

## Business Rules
- Q65 hierarchy, Q66/Q67 roles and permissions, Q64/Q69 invitations and deactivation, R17/R18 catalog and Owner/Admin-only permissions, R15 shared email with a customer, R28 first login with an email code.
- Defaults where the documents are silent: ADR-0016 §6 (listed under Open Items).

## API Changes
API Contract "TASK-012 Amendments": shapes, the new invitation list, `permissions` in the session, errors.

## Database Changes
Migration `roles_permissions`. Database Design "v1.2 TASK-012 Amendments".

## Security / Authorization
Every admin endpoint checks its catalog permission on the server; hierarchy and role scope are enforced in the service, inside the transaction that changes data. Invitation tokens are 256-bit, single use, stored only as SHA-256, kept out of URLs sent to servers, rate-limited per IP on failure. Nobody can change their own level or roles or deactivate themselves. Deactivation revokes sessions and trusted devices immediately. No emails or tokens in logs.

## Acceptance Criteria
- Owner and Admin can do everything; a Manager or Employee can do only what their roles allow, and never an Owner/Admin-only action, whatever a role contains. A role edit applies to the next request.
- Missing permission: `403 PERMISSION_DENIED`; no session: `401`; customer token: `403 FORBIDDEN`.
- Owner invites Admins, Managers, Employees; Admin invites Managers and Employees; Manager invites Employees only and gives only roles within their permissions; Employee invites nobody. Same limits for editing, deactivating and revoking.
- Custom roles are created and edited by Owner/Admin only; system roles cannot be changed.
- An invitation creates an employee only once, only before it expires or is revoked, and only while the inviter may still grant it; the new employee then signs in with an email code.
- Deactivation keeps the employee row and revokes sessions and trusted devices.
- All required checks pass.

## Tests
- Unit `src/server/modules/rbac/rbac.test.ts`: catalog matches the document, level rules, hierarchy, schemas, invitation email.
- Integration `src/server/modules/rbac/rbac-service.int.test.ts`: catalog rows, effective permissions, roles (names, Owner/Admin-only permissions, system roles), invitations (hierarchy, role scope, conflicts, shared customer email, failed email, revoke, listing), acceptance (single use, concurrency, revoked/expired, inviter lost authority, IP block), editing (levels, self, Manager role scope), deactivation.
- Route tests `src/app/api/v1/admin/rbac-routes.int.test.ts`: 401/403/PERMISSION_DENIED, CSRF for cookies, session permissions, roles, the invitation flow end to end, edit and deactivate.

## Edge Cases
- A role lists a permission the Manager lacks: the Manager can neither add nor remove it.
- Two acceptances of the same invitation at once: one employee is created.
- An Owner/Admin-only permission added to a role directly in the database is still ignored for Managers and Employees.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
[BUSINESS DECISION REQUIRED] — safe defaults implemented (ADR-0016 §6), to be confirmed by the product owner:
1. Only the Owner invites and manages Admins; Admins cannot manage other Admins.
2. A Manager manages every Employee-level member (not only those they invited), within their role scope, and never changes levels.
3. An invitation is valid for 7 days.
4. Nobody changes their own level or roles or deactivates themselves.
5. No reactivation of a deactivated employee yet; their email cannot be invited again.
6. Deactivation also forgets trusted devices.
7. The inviter chooses the display name and department; the invitee chooses only the password.

Other:
- Audit records for role and employee changes wait for `audit_logs` (TASK-013).
- The dashboard page `/staff/accept-invitation` does not exist yet (TASK-052); until then the token can be read from the email in `.mail/` and posted to the API.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
