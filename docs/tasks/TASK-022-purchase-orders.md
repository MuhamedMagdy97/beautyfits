# TASK-022 — Purchase Orders & Approval

## Goal
Purchasing staff draft purchase orders to active suppliers; an Owner/Admin approves or rejects them; approved orders are marked sent or cancelled. Every step is audited and nothing changes stock.

## Dependencies
TASK-021 (suppliers), TASK-013 (approval requests, audit), TASK-014 (variants). Used by TASK-023 (goods receiving), TASK-024 (supplier returns and ledger).

## Source of Truth
- Business Spec Q101 (no stock from a PO), Q102 (each purchase keeps its own unit cost), Q112 (who purchases), Q113 (Draft → Pending Approval → Approved → Sent), R19 (approval requests for purchase orders)
- User Flows §14.1, §17.3
- DB Design §11 (`purchase_orders`, `purchase_items`)
- API Contract §21, TASK-013 Amendments (approval requests)
- Permission catalog (`PURCHASE_VIEW`, `PURCHASE_CREATE`, `PURCHASE_APPROVE` Owner/Admin only; Purchasing Manager role)
- ADR-0018 (approval requests; no self-approval), ADR-0026 (inactive suppliers get no new orders)

## Scope
- `purchase_orders` and `purchase_items` tables, numbering, no-delete and draft-only line triggers.
- `GET/POST /admin/purchases`, `GET/PATCH /admin/purchases/{id}`, `POST /admin/purchases/{id}/submit|approve|reject|send|cancel`.
- `PURCHASE_ORDER` approval handler.
- Audit actions `PURCHASE_ORDER_*`.

## Non-Goals
- Goods receipts, receiving statuses, invoices, over-delivery, cost updates and the Q102 margin warning (TASK-023).
- Supplier returns, payments, ledger (TASK-024).
- Sending the order to the supplier by email/WhatsApp; dashboard UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_purchase_orders/`
- `src/server/modules/purchasing/` (`schemas.ts`, `purchase-orders.ts`, `purchase-orders-service.ts`)
- `src/server/modules/approvals/handlers.ts`, `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/purchases/**/route.ts`
- Docs: DB Design "v1.2 TASK-022 Amendments", API Contract "TASK-022 Amendments", ADR-0027

## Business Rules
- Q113: Draft → Pending Approval → Approved → Sent; the approver holds `PURCHASE_APPROVE`.
- Q101: creating or approving an order never changes stock.
- Q102: each line keeps its own unit cost.
- ADR-0026: inactive suppliers get no new orders.
- Owner decisions (ADR-0027 §3): Owner/Admin orders are approved on submit; rejection returns the order to Draft; Send only records the status; draft and published products can be ordered, archived ones cannot.

## API Changes
API Contract "TASK-022 Amendments" (adds `GET`/`PATCH /admin/purchases/{id}` and `POST /admin/purchases/{id}/reject` to §21).

## Database Changes
Migration `purchase_orders`. DB Design "v1.2 TASK-022 Amendments".

## Security / Authorization
`PURCHASE_VIEW` to read, `PURCHASE_CREATE` to draft, edit, submit, send and cancel before approval, `PURCHASE_APPROVE` (Owner/Admin only) to approve, reject and cancel approved orders; enforced server-side. Nobody resolves their own approval request. Cookie writes need the `Origin` check. Totals are computed by the server; input validated with zod.

## Acceptance Criteria
- Orders can be created, listed (paged, by status/supplier, searched by number), viewed, edited while Draft, submitted, approved, rejected back to Draft, sent and cancelled.
- A Purchasing Manager's submit opens one approval request; an Owner/Admin's submit approves at once.
- Approving through `/admin/purchases/{id}/approve` or `/admin/approval-requests/{id}/approve` has the same effect.
- Inactive suppliers and archived products/variants are refused.
- Orders cannot be deleted; their lines cannot change after submit (database-enforced).
- Every change writes an audit entry; no inventory movement is written.
- All required checks pass.

## Tests
- Integration `src/app/api/v1/admin/purchases-routes.int.test.ts`: 401/403 per endpoint (including a Manager role carrying `PURCHASE_APPROVE`), Origin check, full lifecycle with rejection and resubmission, audit sequence, no stock movement, list filters, Owner/Admin approval on submit, approval through the approval list, inactive supplier (create and submit), archived variant, invalid input, unknown and malformed ids, cancellation rules, no-delete and draft-only triggers.

## Edge Cases
- PATCH with the current values (no write, no audit).
- Supplier deactivated between draft and submit (submit refused).
- Approving an order that is no longer pending (`409`).
- Cancelling a pending order also cancels its approval request.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Decided by the product owner on 2026-10-03: ADR-0027 §3.
Technical defaults for the product owner to confirm (ADR-0027 §4):
1. Only drafts are edited; an approved/sent order is changed by cancelling and re-creating it.
2. Cancelling needs a reason.
3. Unit costs positive; quantity 1–100000; max 200 lines, each variant once.
4. No tax on the order (recorded on the supplier invoice, TASK-023).
5. Numbers `PO-000001`, …
6. Order unit costs visible with `PURCHASE_VIEW`.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
