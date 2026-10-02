# TASK-019 — Inventory Ledger & Balances

## Goal
Every variant has Available, Reserved and Damaged quantities that change only through an append-only inventory movement ledger. Staff with `ADJUST_INVENTORY` correct stock with a required reason, every adjustment is audited, and variants at or below their low-stock threshold are listed for inventory staff.

## Dependencies
TASK-014 (variants), TASK-012 (permissions), TASK-013 (audit log). Used by TASK-020 (reservations lock the same balance row and insert movements), TASK-023 (goods receipts insert `PURCHASE_RECEIPT` movements with `unit_cost`), returns and supplier returns, the cart/checkout tasks (Available stock), and the dashboard inventory screens.

## Source of Truth
- Business Spec Q21, Q71, Q72, Q108, Q109, Q110, C6
- User Flows §13
- Architecture §8
- DB Design §5 (`low_stock_threshold`), §10, §17
- API Contract §22
- Permission catalog §1 (`INVENTORY_VIEW`, `ADJUST_INVENTORY`), §3
- AGENTS.md: all inventory changes produce inventory movements

## Scope
- `inventory_balances` (one per variant, created with it) and `inventory_movements` (append-only ledger), with the ledger enforced by database triggers and checks.
- `GET /admin/inventory`, `GET /admin/inventory/{variantId}`, `GET /admin/inventory/{variantId}/movements`, `GET /admin/inventory/low-stock` (`INVENTORY_VIEW`).
- `POST /admin/inventory/{variantId}/adjust` (`ADJUST_INVENTORY`, reason required): correct Available, move Available to Damaged, write Damaged off.
- `low_stock_threshold` on products and variants, set through the existing product/variant PATCH.
- Audit action `INVENTORY_ADJUSTED`.

## Non-Goals
- Reservations and release (TASK-020).
- Goods receipts, purchase-driven stock and cost updates (TASK-023).
- Customer and supplier returns (their tasks).
- Low-stock notifications and purchase suggestions (notifications/analytics tasks, Q110).
- Public stock display (catalog tasks).
- Dashboard UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_inventory_ledger/`
- `src/server/modules/inventory/` (`inventory.ts`, `inventory-service.ts`, `schemas.ts`)
- `src/app/api/v1/admin/inventory/**/route.ts`
- `src/server/modules/catalog/` (`schemas.ts`, `products-service.ts`: thresholds)
- `src/server/modules/audit/audit.ts`
- Docs: DB Design "v1.2 TASK-019 Amendments", API Contract "TASK-019 Amendments", ADR-0024

## Business Rules
- Q108: every stock change creates an inventory movement.
- Q109: Available (sellable), Reserved and Damaged (not sellable) are separate quantities.
- Q71 / Q72: manual adjustment needs `ADJUST_INVENTORY` and a reason, stored in the movement and the audit log.
- Q21 / Q110: low-stock threshold; alerts for Admin and inventory/warehouse staff.

## API Changes
API Contract "TASK-019 Amendments".

## Database Changes
Migration `inventory_ledger`. DB Design "v1.2 TASK-019 Amendments".

## Security / Authorization
`INVENTORY_VIEW` to read, `ADJUST_INVENTORY` to adjust, `PRODUCT_EDIT` for thresholds. All server-side; cookie writes need the `Origin` check. Movement responses carry no cost data.

## Acceptance Criteria
- Every variant, new or existing, has a balance; balances change only through movements (database-enforced), and each balance equals the sum of its movements.
- Movements are append-only; no quantity can go below zero, also under concurrent adjustments.
- An adjustment writes one movement with its reason and one audit entry; a refused one writes nothing (`409 INSUFFICIENT_STOCK`).
- Low stock lists active variants of non-archived products at or below their effective threshold.
- Each endpoint requires its permission; cookie writes need the `Origin` check; all required checks pass.

## Tests
- Unit `inventory.test.ts`: deltas per adjustment type, below-zero detection, effective threshold, low-stock rule, body validation.
- Integration `inventory-routes.int.test.ts`: 401/403, Origin check, balance created with each variant, adjustments + movements + audit, insufficient stock, concurrency, archived adjustments, append-only and balance guard triggers, low stock with product default and variant override, thresholds.

## Edge Cases
- Adjusting below zero (Available or Damaged).
- Concurrent adjustments on the last units.
- Archived variant or product with stock left.
- Threshold 0; threshold removed (`null`); variant override lower or higher than the product default.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Decided by the product owner on 2026-10-02 (ADR-0024 §4):
1. **Adjustments**: correct Available up or down (also opening stock), move Available → Damaged, write Damaged off; Reserved never by hand; never below zero.
2. **Low-stock threshold**: optional on the product, overridable per variant; none means no alert.
3. **Approval**: none; reason, movement and audit entry are the control.

Still open for TASK-020 (DB Design §10): when a reservation is consumed (`CONVERTED`). Technical defaults: ADR-0024 §5.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
