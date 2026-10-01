# ADR-0016 — Roles, permission checks and employee invitations

- **Status:** Accepted (TASK-012); the defaults in §6 confirmed by the product owner on 2026-10-01
- **Date:** 2026-10-01
- **Relates to:** ADR-0013, ADR-0014, ADR-0015; Business Spec Q64–Q69, R15, R17–R19, R28; User Flows §17; permission catalog; API Contract §25 and "TASK-012 Amendments"; DB Design §4 and "v1.2 TASK-012 Amendments"

TASK-012 adds roles, the permission catalog in the database, server-side permission checks, employee management and invitations. The business rules come from the documents: permissions are attached to roles (Q66, Q67); Owner/Admin create Managers and Employees, Managers create Employees only, Employees cannot assign roles (Q65); custom roles are created by Owner/Admin (User Flows §17.1); employees are invited by work email and deactivated, never deleted (Q64, Q69); the codes and the Owner/Admin-only permissions are in the permission catalog (R17, R18). This ADR records how they are enforced and the defaults chosen where the documents are silent (§6).

## 1. Permission catalog

- The codes live in `src/server/modules/rbac/catalog.ts` and in the `permissions` table, whose rows are inserted by the `roles_permissions` migration. A unit test checks the code list against `docs/security/permission-catalog.md` §1 and §2, and an integration test checks the table against the code list. Adding a permission means changing all three.
- The integration-test reset keeps the `permissions` rows (reference data from migrations).

## 2. Effective permissions

- **Owner and Admin** hold every permission, whatever their roles (User Flows §2; catalog §3).
- **Managers and Employees** hold the union of their roles' permissions, **minus the Owner/Admin-only permissions** of catalog §2, even if a role contains them.
- Permissions are read from the database on every request. A role edit, a role or level change, or a deactivation applies to the employee's next request; no session has to end.

## 3. Checking permissions

- `requirePermission(request, code)` (`src/server/modules/rbac/authorization.ts`) runs `requireEmployee` (ADR-0015: `401 UNAUTHENTICATED`, `403 FORBIDDEN`, CSRF check for cookies) and then answers `403 PERMISSION_DENIED` with `details.requiredPermissions` when a code is missing.
- Hierarchy failures are also `403 PERMISSION_DENIED`, with `details.reason`: `HIERARCHY` (the level cannot be managed), `ROLE_OUTSIDE_SCOPE` (a Manager tried to give or take away a role with permissions they do not hold, with `details.roleIds`), `SELF` (own level, roles or deactivation), `SYSTEM_ROLE`.
- `GET /employee-auth/session` now also returns the employee's effective `permissions`, so the dashboard can hide what the employee cannot do. The backend still checks every request.

## 4. Roles

- Custom roles: name (unique ignoring case), optional description, permissions. Created and edited with `ROLE_MANAGE`, which only Owner and Admin can hold.
- A custom role cannot contain an Owner/Admin-only permission (`400 VALIDATION_ERROR`, issue code `permission_owner_admin_only`): roles exist for Managers and Employees, who could never use it.
- `is_system_role` roles cannot be edited or assigned through the API. TASK-004 seeds the default roles of catalog §3 as editable custom roles; Owner and Admin do not need a role.
- Roles are never deleted (no endpoint); this keeps assignment history intact.

## 5. Invitations and employee management

- **Invite** (`POST /admin/employees`, `EMPLOYEE_MANAGE`): email, display name, optional department, level (`ADMIN`, `MANAGER` or `EMPLOYEE`; never `OWNER`) and roles. The inviter must be allowed to manage that level and, if a Manager, to grant every role. The email must not already belong to an employee account (any status) and must not have a pending invitation (`409 CONFLICT`, `details.reason` `EMPLOYEE_EXISTS` / `INVITATION_PENDING`). A customer account with the same email is fine (R15).
- The invitation token is `bfi_` + 256 random bits; only its SHA-256 is stored. It is emailed (Arabic, then English) as a dashboard link with the token in the URL fragment (`<DASHBOARD_URL>/staff/accept-invitation#token=…`), so it never reaches server logs or `Referer` headers. `DASHBOARD_URL` is a new optional setting (default `http://localhost:3000`). The invitation is committed first; a failed email is logged and reported as `emailSent: false`.
- **Accept** (`POST /employee-auth/accept-invitation`, public): token + password (password policy, Q156). It creates the `EMPLOYEE` account (email verified, `ACTIVE`), the employee and its roles, and marks the invitation accepted, in one transaction serialized per email. It **does not sign in**: the first login confirms the device with an email code (R28). Unknown, used or revoked tokens answer `401 AUTH_OTP_INVALID`, expired ones `401 AUTH_OTP_EXPIRED` (as the reset token of ADR-0014). 30 rejected tokens from one IP in 15 minutes block that IP for 15 minutes (`429 AUTH_RATE_LIMITED`, the ADR-0014 wrong-code values).
- At acceptance the inviter's authority is checked again: the invitation stops working if the inviter has been deactivated, lost `EMPLOYEE_MANAGE`, or could no longer grant the level or a role.
- **Edit** (`PATCH /admin/employees/{id}`): name, department, level, roles, within the hierarchy. Role changes record `assigned_by_employee_id`.
- **Deactivate** (`POST /admin/employees/{id}/deactivate`): sets `DEACTIVATED`, revokes every session (`DEACTIVATED`) and every trusted device; nothing is deleted. Deactivating an already deactivated employee changes nothing.
- **Revoke invitation** (`POST /admin/employees/invitations/{id}/revoke`): only pending invitations, within the hierarchy (`409 CONFLICT` otherwise).
- **List**: `GET /admin/employees` (filters `status`, `level`, `search`; pagination) and the new `GET /admin/employees/invitations` (filter `status`).

## 6. Defaults where the documents are silent (confirmed by the product owner, 2026-10-01)

The documents say who creates Managers and Employees but not everything around it. These defaults are implemented and were confirmed by the product owner on 2026-10-01:

1. **Only the Owner invites and manages Admins.** Q65 says Owner/Admin create Managers and Employees but names no one for Admins; an Admin cannot invite, edit or deactivate another Admin or the Owner.
2. **A Manager manages every Employee-level member**, not only those they invited, but can give or take away only roles whose permissions they hold, and can never change a level.
3. **An invitation is valid for 7 days.**
4. **Nobody changes their own level or roles or deactivates themselves.** Editing one's own name and department is allowed with `EMPLOYEE_MANAGE`.
5. **No reactivation yet.** The API contract has no reactivate endpoint, and a deactivated employee's email cannot be invited again (`EMPLOYEE_EXISTS`).
6. **Deactivation also forgets the employee's trusted devices**, so a later reactivation would require the email code again.
7. **The inviter sets the display name and department**; the invitee only chooses the password.

## Consequences

- No new dependency. Migration `roles_permissions` adds `roles`, `permissions` (with the catalog rows), `role_permissions`, `employee_roles` and `employee_invitations`.
- Feature endpoints from TASK-014 onward guard themselves with `requirePermission`.
- There is still no Owner: the first Owner account comes with the bootstrap (TASK-004), which also seeds the default roles of catalog §3.
- `audit_logs` comes with TASK-013. Until then role, invitation, edit and deactivation events are written to the structured logger (actor, target, permission and role changes; no emails or tokens). TASK-013 should turn them into audit records (Architecture §19 lists permission changes as audited actions).
