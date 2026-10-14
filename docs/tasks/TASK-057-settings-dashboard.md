# TASK-057 — Settings, Roles, Approvals & Audit Dashboard

## Goal
Owner and Admins change system settings from the dashboard; critical settings change only after another Owner/Admin approves, and every change is kept with old value, new value, who and when. Staff with the right permissions manage roles and their permissions, resolve the approval queue and read the audit log from dashboard screens.

## Dependencies
TASK-012 (roles, permissions), TASK-013 (audit logs, approval requests), TASK-004 (settings table), TASK-052 (dashboard shell).

## Source of Truth
- Business Spec Q70, Q79, Q179, Q180, Q181, R7, R19, R37.2
- User Flows §17, §18
- DB Design §20 (`settings`, `setting_history`), "v1.2 TASK-057 Amendments"
- API Contract §25, §26, "TASK-012 Amendments", "TASK-013 Amendments", "TASK-057 Amendments"
- Permission catalog §2 (`SETTINGS_MANAGE`, `ROLE_MANAGE`, `APPROVAL_RESOLVE`, `VIEW_AUDIT_LOGS` Owner/Admin only); Security Requirements (settings rows)
- Design reference: no dashboard screen exists in `design-reference/google-stitch/`; the screens follow the Editorial Velvet tokens of the TASK-052 shell
- ADR-0017, ADR-0018, ADR-0045; ADR-0054 (this task)

## Scope
- Migration `20261014057000_setting_history` (table `setting_history`).
- `GET /admin/settings`, `PATCH /admin/settings/{key}`, `GET /admin/settings/history`.
- Critical-setting approval: `CRITICAL_SETTING` requests and their handler; audit action `SETTING_CHANGED`.
- Dashboard screens `/staff/settings`, `/staff/roles`, `/staff/approvals`, `/staff/audit-logs` (Arabic RTL and English).

## Non-Goals
- The employees screen (`/staff/employees` stays the TASK-052 placeholder).
- Settings that do not exist yet (return period, refund policy, R7 percentage): the returns tasks add them as critical.
- Changes to the navigation, shell or shell dictionary.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261014057000_setting_history/`
- `src/server/modules/settings/{settings.ts,settings-service.ts,schemas.ts}`; `approvals/handlers.ts`; `audit/audit.ts`
- `src/app/api/v1/admin/settings/{route.ts,[key]/route.ts,history/route.ts}`
- `src/app/staff/(shell)/_admin/kit.tsx`, `(shell)/{settings,roles,approvals,audit-logs}/page.tsx`

## Business Rules
- Q179: only Owner/Admin change settings (`SETTINGS_MANAGE`).
- Q180: critical settings need Owner/Admin approval; ADR-0018: nobody approves their own request.
- Q181: old value, new value, actor and time are kept (`setting_history`) and audited.
- Critical settings are those the documents name: free-shipping threshold (Q180, R37.2) and COD confirmation timeout (Q180). ADR-0054 §2.

## API Changes
API Contract "TASK-057 Amendments".

## Database Changes
`setting_history`; DB Design "v1.2 TASK-057 Amendments".

## Security / Authorization
Every endpoint checks its permission server-side; `PATCH` is Owner/Admin only. Changes run in one transaction with an advisory lock per key; the approval handler re-checks the value in effect. Screens hide actions cosmetically only. No secrets in snapshots.

## Acceptance Criteria
- A non-critical change applies at once with a history row and an audit entry; the same value changes nothing; invalid values and unknown keys are refused.
- A critical change opens an approval request and leaves the value unchanged; a second proposal is refused while one is pending; the requester cannot approve it; another Owner/Admin's approval applies it (history shows both); a rejection changes nothing; an approval after the value changed is refused and the request stays pending.
- Managers and Employees cannot change settings.
- The four screens work in Arabic and English and show access denied without the permission.
- All required checks pass.

## Tests
- Integration `src/app/api/v1/admin/settings-routes.int.test.ts`: permissions, listing with defaults, direct change with history and audit, unchanged, invalid values/unknown key, critical approve/self-approval/duplicate, reject, stale approval.
- Existing approval, audit and bootstrap tests still pass.

## Edge Cases
- Stored value invalid: the default is shown and treated as current.
- No row stored yet: the history's old value is the default.
- Two changes of one key at once: serialized by the key lock.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] Which other settings are critical (staff session lengths, image limit, minimum margin, guest cart expiry, COD reminder interval/count, COD channel are non-critical for now; ADR-0023 left the minimum margin to this task).
- [BUSINESS DECISION REQUIRED] A store with one Owner and no Admin cannot change a critical setting (no self-approval). Should the Owner's own change skip approval, or must an Admin exist?
- [BUSINESS DECISION REQUIRED] Minimum and maximum of the staff session settings (ADR-0017 §5 item 3).
- No Stitch design exists for these screens; the layout is a proposal.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
