# ADR-0065 — Analytics, employees and dashboard home screens

- **Status:** Proposed (TASK-052A)
- **Date:** 2026-10-15
- **Relates to:** ADR-0045 (dashboard shell), ADR-0052 (analytics aggregation), ADR-0053 (catalog dashboard), ADR-0054 (administration screens); User Flows §17, §19; API Contract §25, §27, "TASK-012 Amendments", "TASK-051 Amendments"

The last dashboard placeholders with a backend were analytics, employees and the home page. This task adds their screens over existing endpoints only; no endpoint, table or business rule changes.

## Decision

1. **Routes.** `/staff/analytics`, `/staff/employees`, `/staff/employees/invitations` replace the `/staff/[section]` placeholder; `/staff` (home) is rewritten. They reuse `staffApi`, `useStaffSession`, `catalog-ui.tsx` (`Guard`, `Loaded`, `Table`, `StatusBadge`, `Tabs`, `Card`) and `_admin/kit.tsx` (`useLoadPage`, `Pager`, `PageHeader`). New texts live in `src/app/staff/_lib/analytics-i18n.ts` so the shared dictionaries stay untouched.
2. **Charts without a dependency.** Bars are CSS widths inside table rows, with the number written beside each bar (the bar is `aria-hidden`). No chart library is added.
3. **Profit.** The profit block calls `/admin/analytics/profit` only when the session holds `VIEW_PROFIT`; cost columns in the product table appear only when the API includes them. The API remains the only gate.
4. **Employee detail.** There is no `GET /admin/employees/{id}`; the detail is an expandable row built from the list item, with edit (`PATCH`, only changed fields) and deactivate. Role choices come from `GET /admin/roles` (`ROLE_VIEW`); without that permission the forms leave roles out and say so. Owner rows and deactivated rows offer no actions (Q65: nobody manages the Owner); every other hierarchy rule is left to the API, whose `details.reason` is shown.
5. **Home queues.** Counts come from existing list endpoints read with `pageSize=1` (`meta.pagination.totalPages` is then the item count), each shown only with the permission its endpoint checks: COD-pending and new orders, returns awaiting approval, open contact tasks, low stock, pending approvals, pending invitations. Today's KPIs use `overview?range=TODAY` with `ANALYTICS_VIEW`.

## Consequences

- Seven small count requests on the home page for a fully privileged employee; acceptable now, a summary endpoint can replace them later.
- Brand and category performance (User Flows §19) have no endpoint yet and are not shown.
