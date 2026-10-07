# ADR-0041 — Wishlist

- **Status:** Accepted (TASK-042)
- **Date:** 2026-10-07
- **Relates to:** ADR-0031 (cart); Business Spec Q4, Q47, Q48, Q51; User Flows §4.2; DB Design §15 and "v1.2 TASK-042 Amendments"; API Contract §19 and "TASK-042 Amendments"

## Decision

- `wishlists` (one per customer, unique `customer_id`, created on the first add) and `wishlist_items` (unique `wishlist_id + product_variant_id`, FK to the variant `RESTRICT`, items cascade with their wishlist). The wishlist stores intent only; reads compute status and price from the current product, variant and stock.
- Status per item: `UNAVAILABLE` when the product is not `PUBLISHED`, the variant not `ACTIVE` or it has no selling price (Q48, no price shown); otherwise `OUT_OF_STOCK` at zero available stock (Q47, shown as Coming Soon / Notify Me) or `AVAILABLE`.
- Adding needs an active variant of a published product (any stock); adding an item already there is a no-op returning the wishlist.
- Removing deletes the row: wishlist items are not referenced by orders, inventory, financial or audit records.
- Move-to-cart runs in one transaction: delete the item, then `addToCustomerCart` (the cart's `addItem` rules, ADR-0031 §2–3) with quantity 1. Any cart refusal rolls back, so the item stays. A retry after success is `404`, never a second unit.
- Every write locks the customer row first, the same lock cart writes take, so wishlist and cart writes of one customer serialize without deadlocks.
- Technical limit (not a business rule): 100 items per wishlist (`409 CONFLICT`, `reason = WISHLIST_LIMIT_REACHED`).

## Consequences

- Migration `20261008042000_wishlist`. No new dependency.
- R6 reminder state (`last_reminded_at`, `reminder_count`, `reminders_stopped_reason`) and restock subscriptions come with TASK-043.
