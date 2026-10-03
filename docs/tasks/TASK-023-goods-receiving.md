# TASK-023 — Goods Receiving & Supplier Invoices

## Goal
Warehouse staff record what each supplier delivery brought, after inspecting it. Good units go to Available stock and damaged ones to Damaged, with the purchase costs updated. Extras wait for an Owner/Admin. Supplier invoices are kept exactly as issued, and finished orders are closed. Everything is audited.

## Dependencies
TASK-022 (purchase orders), TASK-019 (inventory ledger), TASK-018 (costs), TASK-016 (uploads), TASK-013 (approval requests, audit). Used by TASK-024 (supplier returns, payments, ledger).

## Source of Truth
- Business Spec Q101 (stock only through goods receipts), Q102 (margin warning), Q103 (latest and weighted average cost), Q104 (damaged units not sellable), Q109 (Damaged quantity), Q114 (who receives), Q115 (short delivery), Q116 (over-delivery approval), Q117 (invoice mandatory), R9 (rounding), R19 (approval requests)
- User Flows §14.1–14.3
- DB Design §11 (`goods_receipts`, `goods_receipt_items`, `purchase_invoices`), "v1.1" supplier traceability
- API Contract §21 (`/admin/purchases/{id}/receive`), v1.1 "Supplier finance" (`/admin/purchases/{id}/invoice`), §28 (uploads)
- Permission catalog (`RECEIVE_PURCHASE`, `PURCHASE_APPROVE`, `SUPPLIER_PAYMENT_MANAGE`, `SUPPLIER_FINANCE_VIEW`)
- ADR-0023 (costs lock after the first receipt), ADR-0024 (ledger), ADR-0027 (purchase orders)

## Scope
- `goods_receipts`, `goods_receipt_items`, `purchase_invoices`, closing columns on `purchase_orders`, `PURCHASE_RECEIPT` movement type, `SUPPLIER_INVOICE` upload purpose.
- `POST /admin/purchases/{id}/receive`, `POST /admin/purchases/{id}/invoice`, `POST /admin/purchases/{id}/close`; receipts, received quantities and invoices in the purchase view; receiving staff may read orders without amounts.
- `PURCHASE_OVER_DELIVERY` approval handler.
- Cost updates and the Q102 cost review.
- Audit actions `GOODS_RECEIPT_RECORDED`, `PURCHASE_OVER_DELIVERY_ACCEPTED|REJECTED`, `PURCHASE_INVOICE_RECORDED`, `PURCHASE_ORDER_CLOSED`.

## Non-Goals
- Supplier returns, payments, credits, ledger (TASK-024).
- Notifications for margin warnings; PDF invoices; dashboard UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_goods_receipts/`
- `src/server/modules/purchasing/` (`goods-receipts.ts`, `goods-receipts-service.ts`, `schemas.ts`, `purchase-orders-service.ts`)
- `src/server/modules/approvals/handlers.ts`, `src/server/modules/audit/audit.ts`, `src/server/modules/media/` (purpose), `src/server/modules/rbac/authorization.ts` (`requireAnyPermission`), `src/server/http/validation.ts` (`requireIdempotencyKey`)
- `src/app/api/v1/admin/purchases/**/route.ts`
- Docs: DB Design "v1.2 TASK-023 Amendments", API Contract "TASK-023 Amendments", ADR-0028

## Business Rules
- Q101/Q104: stock enters only through a goods receipt; damaged and unaccepted units never reach Available.
- Q115: a short delivery is received as it is; the invoice is not edited.
- Q116: extras wait for Owner/Admin approval.
- Q117: an invoice is required (enforced at closing); discrepancies need a description.
- Owner decisions (ADR-0028 §3): one-step receiving; damaged units into Damaged; approved extras at the line's cost; manual close with a reason by `PURCHASE_CREATE`, once invoiced.

## API Changes
API Contract "TASK-023 Amendments".

## Database Changes
Migration `goods_receipts`. DB Design "v1.2 TASK-023 Amendments".

## Security / Authorization
`RECEIVE_PURCHASE` to receive; `SUPPLIER_PAYMENT_MANAGE` to record invoices and upload invoice files; `SUPPLIER_FINANCE_VIEW` or `SUPPLIER_PAYMENT_MANAGE` to see invoices and their files; `PURCHASE_CREATE` to close; Owner/Admin (`APPROVAL_RESOLVE`) to resolve extras, never their own request. Amounts are hidden from receiving staff without `PURCHASE_VIEW`. All checks are server-side and inputs are validated with zod. `/receive` requires `Idempotency-Key`. Cost values are never logged.

## Acceptance Criteria
- Short, complete, damaged and over deliveries are recorded with the correct Available/Damaged movements and order status.
- Costs update on accepted units (latest cost, weighted average, first receipt date); the cost review shows the margin warnings.
- Extras are held until approved through the approval list; an Owner/Admin's own extras are accepted at once; rejected extras never enter stock.
- Invoices are recorded once per number, with an invoice file; they cannot be changed.
- Closing needs an invoice and no pending extras; a closed or partly received order cannot be received or cancelled.
- A retried receive with the same key records once.
- All required checks pass.

## Tests
- Unit `src/server/modules/purchasing/goods-receipts.test.ts`: delivery split and note rule.
- Integration `src/app/api/v1/admin/receiving-routes.int.test.ts`: permissions and hidden amounts, short delivery → invoice → close with audit, damaged stock and weighted average with margin warning, extras approved / rejected / accepted on an Owner's receipt, idempotent retry and key reuse, invalid receipts and statuses, invoice validation, append-only triggers.

## Edge Cases
- Damaged units beyond the delivery or beyond what is due (`400`).
- A line already complete in a partly received order: everything delivered for it is extra. Receiving a `RECEIVED` order is refused.
- An invoice file of another purpose or already attached.
- Closing while extras await approval (`409 OVER_DELIVERY_PENDING`).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Decided by the product owner on 2026-10-03: ADR-0028 §3.
Technical defaults to confirm (ADR-0028 §4):
1. Damaged units count against the ordered quantity; damaged extras are refused.
2. A note is required for short, damaged or extra lines.
3. Invoices carry no lines; several per order, number unique per order.
4. Invoice files are images only in v1.
5. Extras are approved or rejected per receipt, all together.
6. Weighted average over Available + Reserved; damaged units carry no weight.
7. The cost review lists every cost change, for `VIEW_COST_PRICE` holders only.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
