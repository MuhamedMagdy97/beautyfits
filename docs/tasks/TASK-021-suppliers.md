# TASK-021 — Suppliers

## Goal
Staff with the purchasing permissions keep a list of suppliers with their contact details, can deactivate a supplier without losing any history, and every change is audited.

## Dependencies
TASK-012 (permissions), TASK-013 (audit log). Used by TASK-022 (purchase orders link a supplier, only active ones), TASK-023 (invoices), TASK-024 (supplier returns, ledger, payments).

## Source of Truth
- Business Spec Q112 (who manages purchasing), Q118/Q119 (supplier finance, later tasks)
- User Flows §14
- DB Design §11 (`suppliers`)
- API Contract §21
- Permission catalog (`SUPPLIER_VIEW`, `SUPPLIER_MANAGE`; Purchasing / Inventory Manager roles)
- AGENTS.md: preserve historical data; audit important actions

## Scope
- `suppliers` table with `ACTIVE` / `INACTIVE` and a no-delete trigger.
- `GET /admin/suppliers`, `POST /admin/suppliers`, `PATCH /admin/suppliers/{id}`.
- Audit actions `SUPPLIER_CREATED`, `SUPPLIER_UPDATED`.

## Non-Goals
- Purchase orders and the "inactive supplier" refusal (TASK-022).
- Invoices, returns, ledger, balances, payments (TASK-023, TASK-024).
- Dashboard UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_suppliers/`
- `src/server/modules/suppliers/` (`schemas.ts`, `suppliers-service.ts`)
- `src/app/api/v1/admin/suppliers/**/route.ts`
- `src/server/modules/audit/audit.ts`
- Docs: DB Design "v1.2 TASK-021 Amendments", API Contract "TASK-021 Amendments", ADR-0026

## Business Rules
- Q112: Owner/Admin and the Purchasing Manager manage purchasing, limited by permissions.
- History is never erased (AGENTS.md): suppliers are deactivated, not deleted.

## API Changes
API Contract "TASK-021 Amendments".

## Database Changes
Migration `suppliers`. DB Design "v1.2 TASK-021 Amendments".

## Security / Authorization
`SUPPLIER_VIEW` to list, `SUPPLIER_MANAGE` to create and edit; enforced server-side. Cookie writes need the `Origin` check. Input validated with zod (name, phone format, email).

## Acceptance Criteria
- Suppliers can be created, listed (paged, by status, searched by name/phone/email), edited, deactivated and reactivated.
- Names are unique ignoring case.
- A supplier cannot be deleted (database-enforced).
- Every create and real change writes one audit entry; an unchanged PATCH writes none.
- Each endpoint requires its permission; all required checks pass.

## Tests
- Integration `src/app/api/v1/admin/suppliers-routes.int.test.ts`: 401/403, Origin check, create/list/search/edit/deactivate/reactivate with audit entries, duplicate names (create and rename), invalid input, unknown and malformed ids, no-delete trigger.

## Edge Cases
- Renaming a supplier to a case variant of its own name (allowed).
- Clearing optional fields with `null`.
- PATCH with values equal to the current ones (no write, no audit).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Technical defaults for the product owner to confirm (ADR-0026 §2):
1. **Status**: `ACTIVE` / `INACTIVE`; inactive suppliers get no new purchase orders, history continues; reactivation allowed.
2. **Contacts**: one phone, email and address per supplier; other contacts in `notes`.
3. **Names**: unique ignoring case.
4. **Approval**: none; permission and audit are the control.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
