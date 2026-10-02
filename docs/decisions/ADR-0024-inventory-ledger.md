# ADR-0024 — Inventory ledger and balances

- **Status:** Accepted (TASK-019); the decisions in §4 taken and the defaults in §5 confirmed by the product owner on 2026-10-02
- **Date:** 2026-10-02
- **Relates to:** ADR-0018 (audit logs), ADR-0019 (variants), ADR-0023 (costs); Business Spec Q21, Q71, Q72, Q108, Q109, Q110, C6; User Flows §13; Architecture §8; DB Design §10 and "v1.2 TASK-019 Amendments"; API Contract §22 and "TASK-019 Amendments"; permission catalog §1

## 1. Data

- `inventory_balances`: one row per variant (`product_variant_id` is the key), with `available_quantity` (sellable), `reserved_quantity` and `damaged_quantity` (not sellable, Q109), all integers ≥ 0 (check `inventory_balances_quantities_check`).
- `inventory_movements`: the ledger (Q108). One row per stock change, with a delta for each quantity (`available_delta`, `reserved_delta`, `damaged_delta`, at least one non-zero), `movement_type`, optional `reference_type`/`reference_id` (the goods receipt, order, … behind it), `unit_cost` (piastres, for TASK-023), `reason`, `created_by_type`/`created_by_id`, `created_at`.
- One row with three deltas instead of the single `quantity_delta` of DB Design §10: a move between quantities (Available → Damaged now, Available → Reserved in TASK-020) is one movement, and every balance equals the sum of its movements.
- `low_stock_threshold` (integer ≥ 0, nullable) on `products` and on `product_variants` (§4 item 2).

## 2. The ledger is enforced by the database

- Trigger `inventory_balances_create`: inserting a variant creates its balance; the migration created the balances of existing variants.
- Trigger `inventory_movements_apply`: inserting a movement adds its deltas to the balance. The balance check rejects any movement that would take a quantity below zero, so no code path can oversell or go negative.
- Trigger `inventory_movements_append_only`: movements are never updated or deleted.
- Trigger `inventory_balances_guard`: a balance is updated only from the movement trigger and never deleted, so stock cannot change without a movement.
- Services lock the balance row (`SELECT … FOR UPDATE`) before writing a movement, so concurrent changes run one after another and a refusal is a clear `409 INSUFFICIENT_STOCK` rather than a constraint error. TASK-020 reserves the same way.

## 3. Manual adjustments

`POST /admin/inventory/{variantId}/adjust` (`ADJUST_INVENTORY`, Q71) with a required reason (Q72) and one of:

| `type` | Quantity | Effect |
|---|---|---|
| `MANUAL_ADJUSTMENT` | signed, non-zero | Available ± quantity (stock counts, opening stock) |
| `DAMAGE` | positive | Available − q, Damaged + q |
| `DAMAGE_WRITE_OFF` | positive | Damaged − q |

Each adjustment writes one movement (with the reason) and one audit entry `INVENTORY_ADJUSTED` (entity `PRODUCT_VARIANT`; previous and new quantities, movement id, type, quantity, reason, request id).

## 4. Decisions by the product owner (2026-10-02)

1. **What an adjustment may do:** correct Available up or down (including opening stock, since goods receipts arrive with TASK-023), move Available to Damaged, and write Damaged off. Reserved is never adjusted by hand. No quantity goes below zero.
2. **Low-stock threshold:** an optional threshold on the product applies to all its variants; a variant may override it. No threshold, no alert. Settles DB Design §5 `[BUSINESS DECISION REQUIRED]` (Q21 vs C6).
3. **No approval:** an adjustment applies directly for `ADJUST_INVENTORY` holders; the reason, movement and audit entry are the control.

## 5. Technical defaults (confirmed by the product owner, 2026-10-02)

1. Low stock is `available_quantity <= threshold`, for active variants of non-archived products (API §22 "at or below").
2. Thresholds are set through the existing `PATCH /admin/products/{id}` and `PATCH /admin/variants/{id}` (`PRODUCT_EDIT`, audited with the product/variant); `null` removes one. 0 to 1,000,000.
3. Archived variants and products can still be adjusted: their stock is physical and must be countable and writable off. They never raise a low-stock alert.
4. One adjustment moves at most 1,000,000 units. Adjustments take no `Idempotency-Key` (API §22 does not require one); a repeated request is a visible second movement.
5. Movement responses leave out `unit_cost` (cost data, `VIEW_COST_PRICE`); TASK-023, which first sets it, decides how to show it.
6. The overview lists every variant (archived included) by SKU, searchable by SKU or product name; low stock lists lowest Available first.
7. Movement types for later tasks (purchase receipt, reservation, release, returns, supplier returns) are added to the `inventory_movement_type` enum by those tasks.

## Consequences

- Migration `inventory_ledger` (two tables, one enum, two threshold columns, five checks, four triggers).
- New audit action code `INVENTORY_ADJUSTED`.
- New module `src/server/modules/inventory/`; TASK-020 adds reservations on top of the same balance lock and movement insert.
- DB Design §10 `[BUSINESS DECISION REQUIRED]` on reservation movements stays open for TASK-020; AGENTS.md ("all inventory changes must produce inventory movements") and the balance guard mean a reservation changes stock only through a movement.
- No new dependency.
