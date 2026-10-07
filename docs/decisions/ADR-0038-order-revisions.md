# ADR-0038 — Order Revisions

- **Status:** Accepted (TASK-032)
- **Date:** 2026-10-07
- **Relates to:** ADR-0036 (state machine, immutable snapshots), ADR-0035 (checkout pricing), ADR-0025 (reservations), ADR-0032 (discount engine), ADR-0033 (shipping), ADR-0034 (wallet holds); Business Spec C4, C5, Q32, R40; User Flows §9; API §15 and "TASK-032 Amendments"; DB Design "v1.2 TASK-032 Amendments"

## 1. Preview, then confirm

`modify` prices the requested state and stores it as an `order_revisions` row; nothing else changes, so an abandoned change needs no undo. `confirm` re-prices the stored request and compares it (canonical JSON) with what the customer saw: any difference is `RECONFIRMATION_REQUIRED`, never a silent re-price (as R38.2 for checkout). One open revision per order (partial unique index); a new one marks the open one `SUPERSEDED`. Lapsing after 24 hours is checked on use and shown on read, so no job is needed.

## 2. Pricing

The pure `planLines` keeps ordered quantity at its order price (cheapest first when a variant already has two prices) and prices the rest at today's price. The order's discount is evaluated with the engine using its order-time percentage, cap and minimum and without date or usage limits (its use is already counted). Shipping uses `quoteShippingForArea`; address resolution is shared with checkout (`resolveAddress`). Stock beyond what the order holds must be available.

## 3. Applying a revision

In one transaction: lock the order, `releaseForOrder` then `reserveForOrder` with the new lines, release and re-reserve the wallet hold, update or release the discount use, then delete and recreate the order items and update the order's commercial columns. The previous lines and amounts are kept in `previous_snapshot_json`, so history is preserved without being rewritten silently (C5).

## 4. Immutability stays enforced

Instead of dropping the triggers, they now accept commercial changes only when the transaction set `beautyfits.order_revision = on` (`set_config(..., true)`, transaction-local); the revision code sets it just before the change and resets it after. Identity columns never change and item rows are never updated, only replaced by a revision. This guards against accidental writes; it is not a security boundary against code using the same database role.

## 5. Status

A confirmed change on a `Confirmed` order uses the new edge `CONFIRMED → NEW` (R40.7, actor the customer). An order still `Pending Confirmation` keeps its COD deadline; when the wallet now covers the total it moves to `New`, as at checkout (C4).

## Consequences

- One variant can have two order lines (the unique key includes `unit_price`); later shipping and return tasks must treat lines, not variants, as the unit.
- Reservation and wallet records show a release and a new hold for every confirmed revision.
