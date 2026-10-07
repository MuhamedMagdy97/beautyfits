# ADR-0042 — Verified Reviews

- **Status:** Accepted (TASK-044)
- **Date:** 2026-10-07
- **Relates to:** ADR-0036 (order core), ADR-0018 (audit logs), ADR-0019 (products and variants); Business Spec Q3, Q11, Q12, Q49, Q50, Q171–Q174, C6; User Flows §5; API §20 and "TASK-044 Amendments"; DB Design §16 and "v1.2 TASK-044 Amendments"

## 1. One review per delivered order and product

A review references the qualifying `order_item_id` (so the purchased variant is known, C6) but is unique on `(order_id, product_id)`. Business Spec Q12/Q49 and User Flows §5 say "one review per successful purchase/order ... for the product"; DB Design §16 says "per order item". The higher documents win: an order with two shades of one lipstick gives one review. A "successful purchase" is an order in `DELIVERED`, which TASK-034 reaches; until then the integration tests set the status directly. The unique index makes concurrent submissions safe; the loser gets `409 CONFLICT` with the existing `reviewId`.

## 2. Published immediately; checks are structural for now

Reviews and edits publish without approval (Q11, Q50, Q173). The automated checks in v1 are the ones the documents define: verified purchase, ownership, one per order and product, rating 1–5 and non-blank text (also database checks). Content filters (words, links) and rate-limit thresholds are not defined, so they are open business decisions rather than invented rules. Abuse is already bounded: reviews by delivered orders, reports by one per customer and review.

## 3. Moderation is a status plus an append-only history

`status` is `PUBLISHED` or `HIDDEN`. Hide (reason required) and restore lock the review row, refuse a no-op with `CONFLICT`, and write a `review_moderation_history` row and an audit entry in the same transaction. The database rejects deleting reviews and reports and any change of history rows (Q174). The DB design's `REPORTED` status became a separate `review_reports` table so several reports and hide/restore never overwrite each other; hiding resolves open reports. An author's edit never changes the status, so editing cannot undo a hide.

## 4. Public display is product-level and anonymous

`GET /products/{productId}/reviews` serves published reviews of a published product with `reviewCount` and `averageRating`, plus the order-time variant name. It names no reviewer: what to show is an open business decision and showing nothing is the private default.

## Consequences

- Reviews become possible once TASK-034 delivers orders; nothing else changes then.
- If returns (TASK-037/038) should remove eligibility or hide reviews, that is a later decision; reviews reference orders and can be found by `order_id`.
- TASK-061 adds rate limits and content checks once the owner sets them.
