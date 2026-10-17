# TASK-052A — Analytics, Employees & Dashboard Home Screens

## Goal
Staff open real screens instead of placeholders for analytics, employees (with invitations) and the dashboard home, each tailored to the session's permissions.

## Dependencies
TASK-011, TASK-012 (employees, invitations, roles), TASK-051 (analytics reports), TASK-052 (dashboard shell), TASK-053/057 (shared dashboard pieces).

## Source of Truth
- Business Spec (analytics ranges, Q64, Q65, Q103, Q150)
- User Flows §17.1, §19
- API Contract §25, §27, "TASK-012 Amendments", "TASK-051 Amendments"
- Permission catalog (`ANALYTICS_VIEW`, `VIEW_PROFIT`, `EMPLOYEE_VIEW`, `EMPLOYEE_MANAGE`, `ROLE_VIEW`)
- Design reference: no dashboard screen exists in `design-reference/google-stitch/`; the screens follow the TASK-052 shell tokens
- ADR-0045, ADR-0052, ADR-0053, ADR-0054; ADR-0065 (this task)

## Scope
- `/staff/analytics`: periods Today/Yesterday/7D/30D/90D/Custom; overview KPIs, revenue by day, orders by status, funnel, product performance; COGS and estimated gross profit only with `VIEW_PROFIT`.
- `/staff/employees`: list with search/status/level filters, expandable detail, edit (name, department, level, roles), deactivate.
- `/staff/employees/invitations`: list by status, invite, revoke.
- `/staff` home: today's KPIs (`ANALYTICS_VIEW`), counts of waiting work from existing list endpoints, the sections grid.

## Non-Goals
- New endpoints (no employee detail endpoint, no home summary endpoint).
- Brand/category performance reports (no endpoint).
- Changes to the shell navigation or shared dictionaries.

## Files / Modules
- `src/app/staff/(shell)/page.tsx`
- `src/app/staff/(shell)/analytics/{page.tsx,report.tsx}`
- `src/app/staff/(shell)/employees/{page.tsx,parts.tsx,invitations/page.tsx}`
- `src/app/staff/_lib/{analytics.ts,analytics-i18n.ts,analytics.test.ts}`

## Business Rules
- Figures come from the API only (sales from revenue orders, Q103/Q150 costs); amounts are integer piastres shown as EGP.
- Hierarchy (Q65) is enforced by the API; the screens hide actions for the Owner and deactivated employees and show the API's refusal reason otherwise.
- Deactivation keeps history and revokes sessions (API); the screen asks for confirmation.

## API Changes
None.

## Database Changes
None.

## Security / Authorization
Every screen is guarded by the permission its endpoint checks; hiding is cosmetic and the API authorizes every call. The profit endpoint is called only with `VIEW_PROFIT`.

## Acceptance Criteria
- The three routes render in Arabic (RTL) and English and show access denied without the permission.
- Period changes reload every report; an incomplete or reversed custom range asks for valid days instead of calling the API.
- Profit appears only for `VIEW_PROFIT`.
- Invite, revoke, edit and deactivate work and show API refusals in words.
- Home shows only the KPIs and queues the session may read.
- All required checks pass.

## Tests
- Unit `src/app/staff/_lib/analytics.test.ts`: range query, percent, count path, Arabic/English key parity.
- Existing integration tests cover the endpoints (TASK-011/012/051).
- Browser check against the development seed.

## Edge Cases
- Periods without activity show "no activity"; zero visitors give 0% rather than a division by zero.
- Invitation created but email not sent (`emailSent: false`) is reported.
- Employees without `ROLE_VIEW` invite and edit without choosing roles.

## Definition of Done
Acceptance criteria met, checks green, docs updated.

## Open Items
- Resolved (owner decision 2026-10-18): not in v1 — brand and category performance reports (User Flows §19) are a possible follow-up task (BD-067).

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
