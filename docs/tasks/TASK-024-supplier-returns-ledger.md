# TASK-024 — Supplier Returns, Payments & Ledger

## Goal
Damaged units received from a supplier go back to them after an Owner review and leave Damaged stock. The refund or credit is recorded. Everything that changes what we owe a supplier (invoices, payments, return credits and refunds) is an append-only ledger entry, so the balance and each purchase order's payment status can be traced. Everything is audited.

## Dependencies
TASK-023 (goods receipts, invoices), TASK-022 (purchase orders), TASK-019 (inventory ledger), TASK-013 (approval requests, audit).

## Source of Truth
- Business Spec Q105 (Owner review, then return), Q106 (link to the purchase), Q107 (refund or credit), Q118 (Paid / Partially Paid / Unpaid), Q119 (payable balance), Q120 (expected amount from cost), R9, R19, Audit Correction 6
- User Flows §14.4
- DB Design §11 (`supplier_returns`, `supplier_return_items`), v1.1 (`supplier_ledger_entries`, `supplier_payments`)
- API Contract §21, v1.1 "Supplier finance", "TASK-002A Amendments" (permissions, idempotency)
- Permission catalog (`SUPPLIER_RETURN_MANAGE`, `SUPPLIER_PAYMENT_MANAGE`, `SUPPLIER_FINANCE_VIEW`, `APPROVAL_RESOLVE`, `PURCHASE_APPROVE`)
- ADR-0028 (goods receiving), ADR-0024 (ledger), ADR-0018 (approvals)

## Scope
- `supplier_returns`, `supplier_return_items`, `supplier_payments`, `supplier_ledger_entries`; `SUPPLIER_RETURN` movement type and approval type; ledger entries for invoices (with backfill).
- `POST /admin/purchases/{id}/supplier-return`, `POST /admin/supplier-returns/{id}/submit|settle`, `GET /admin/supplier-returns[/{id}]`, `POST /admin/suppliers/{id}/payments`, `GET /admin/suppliers/{id}/ledger|balance`.
- `SUPPLIER_RETURN` approval handler.
- Audit actions `SUPPLIER_RETURN_CREATED|SUBMITTED|APPROVED|REJECTED|SETTLED`, `SUPPLIER_PAYMENT_RECORDED`.

## Non-Goals
- Ledger corrections (`ADJUSTMENT`), draft editing/cancelling, payment documents, return shipping documents, dashboard UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_supplier_returns_ledger/`
- `src/server/modules/purchasing/` (`supplier-returns.ts`, `supplier-returns-service.ts`, `supplier-ledger.ts`, `schemas.ts`, `goods-receipts-service.ts`)
- `src/server/modules/approvals/` (`handlers.ts`, `schemas.ts`), `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/purchases/[id]/supplier-return/`, `src/app/api/v1/admin/supplier-returns/**`, `src/app/api/v1/admin/suppliers/[id]/{ledger,balance,payments}/`
- Docs: DB Design "v1.2 TASK-024 Amendments", API Contract "TASK-024 Amendments", ADR-0029, Business Spec R19 (addition)

## Business Rules
- Q105/Q106: returns send back damaged units of goods receipt lines after Owner/Admin review; history is never erased.
- Q107/Q120: the expected amount is quantity × purchase unit cost; settlement records refund, credit or other.
- Q118/Q119: payable balance and payment status per purchase order come from the ledger.
- Owner decisions (ADR-0029 §3): invoices create payables (with backfill); Owner/Admin approval request, own returns approved at once, rejection final; stock leaves Damaged on approval; settlement by method (refund = credit + cash received); partial and over-payments allowed; no corrections in v1.

## API Changes
API Contract "TASK-024 Amendments".

## Database Changes
Migration `supplier_returns_ledger`. DB Design "v1.2 TASK-024 Amendments".

## Security / Authorization
`SUPPLIER_RETURN_MANAGE` to create and submit returns; `APPROVAL_RESOLVE` (Owner/Admin) to approve or reject, never their own; `SUPPLIER_PAYMENT_MANAGE` to settle and record payments; `SUPPLIER_FINANCE_VIEW` for the ledger and balance. All checks are server-side; inputs are validated with zod; amounts are integer piastres; payments require `Idempotency-Key`. Ledger entries, payments and return lines are append-only in the database.

## Acceptance Criteria
- A return can only take damaged units still available on the receipt line; approval moves them out of Damaged with a `SUPPLIER_RETURN` movement.
- Returns by staff wait for Owner/Admin approval; an Owner's own return is approved at once; rejected returns free their units.
- Settlement writes the right ledger entries for CREDIT, REFUND and OTHER; a different amount needs a note.
- Invoices add payables; payments lower them; the balance and Q118 status per order are correct; a retried payment records once.
- All required checks pass.

## Tests
- Unit `src/server/modules/purchasing/supplier-ledger.test.ts`: direction signs, Q118 status, schemas.
- Integration `src/app/api/v1/admin/supplier-finance-routes.int.test.ts`: permissions, credit flow with approval and stock movement, Owner auto-approval with refund and OTHER, rejection and written-off stock, payments (partial, advance, idempotent retry, key reuse, wrong order) with balance and status, append-only triggers.

## Edge Cases
- Units on a pending return cannot go on another (`400` at create, `409 RETURN_QUANTITY_EXCEEDED` at submit/approval).
- Damaged stock written off before approval (`409 DAMAGED_STOCK_INSUFFICIENT`; the request stays pending).
- Settling twice, settling a draft or rejected return (`409 SUPPLIER_RETURN_STATUS_INVALID`).
- Payment for an order of another supplier (`400 purchase_not_found`).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Decided by the product owner on 2026-10-03: ADR-0029 §3.
- [BUSINESS DECISION REQUIRED] Correcting a mistaken payment or ledger entry (`ADJUSTMENT` entries: who, which permission, whether an approval is needed). Not available in v1.
- Record the R19 addition (supplier returns use approval requests) in `docs/decisions/business-rules-ledger.xlsx`.

Technical defaults to confirm (ADR-0029 §4):
1. Only units damaged on receipt can be returned, per goods receipt line.
2. Settlement only after approval, by `SUPPLIER_PAYMENT_MANAGE`.
3. Payment methods `CASH`, `BANK_TRANSFER`, `CHEQUE`, `OTHER`; a payment may name one purchase order of the supplier.
4. Payments allowed for inactive suppliers.
5. No draft editing or cancelling endpoint; drafts hold no units.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
