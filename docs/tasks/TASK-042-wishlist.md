# TASK-042 — Wishlist

## Goal
Signed-in customers keep a wishlist of variants. Items stay visible when they sell out (Coming Soon / Notify Me) or stop being sellable (unavailable), and can be moved to the cart.

## Dependencies
TASK-009 (customer `/me` area), TASK-014 (variants), TASK-017 (publishing), TASK-019 (inventory balances), TASK-025 (cart `addItem`).

## Source of Truth
- Business Spec Q4 (account-only), Q47 (out of stock: keep visible, offer Coming Soon / Notify Me; no automatic subscription), Q48 (unavailable: keep visible), Q51 (Notify Me is separate)
- User Flows §4.2
- DB Design §15 (`wishlists`, `wishlist_items`)
- API Contract §19
- ADR-0031 (cart), ADR-0041

## Scope
- `wishlists` (one per customer, created on the first add) and `wishlist_items` (unique per variant).
- `GET /me/wishlist`, `POST /me/wishlist/items`, `DELETE /me/wishlist/items/{itemId}`, `POST /me/wishlist/items/{itemId}/move-to-cart`.
- Item status `AVAILABLE` / `OUT_OF_STOCK` / `UNAVAILABLE` from the current product, variant, price and stock.
- `addToCustomerCart` in `src/server/modules/cart/cart-service.ts`: the cart's add rules inside the caller's transaction (used by move-to-cart).

## Non-Goals
- Restock `Notify Me` subscriptions and wishlist purchase reminders, including the R6 reminder state columns on `wishlist_items` (TASK-043).
- Notifications (TASK-045), analytics events (TASK-050), website UI (TASK-060).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261008042000_wishlist/`
- `src/server/modules/wishlist/` (`wishlist-service.ts`, `schemas.ts`)
- `src/server/modules/cart/cart-service.ts` (`addLine` extracted from `addItem`, `addToCustomerCart`)
- `src/app/api/v1/me/wishlist/**`
- Docs: DB Design "v1.2 TASK-042 Amendments", API Contract "TASK-042 Amendments", ADR-0041, roadmap

## Business Rules
- Q4: account-only; guests get `401`.
- Only active variants of published products can be added (in stock or not). Adding a variant already on the wishlist changes nothing.
- Q47: an out-of-stock item stays, status `OUT_OF_STOCK` (shown as Coming Soon / Notify Me); being on the wishlist never subscribes the customer to restock (Q51).
- Q48: an item whose product is unpublished/disabled/archived, variant archived or price missing stays, status `UNAVAILABLE`, no price.
- Move-to-cart adds one unit with the cart rules (purchasable, stock, 50-line limit) and removes the item from the wishlist, in one transaction; a refusal changes nothing.

## API Changes
API Contract "TASK-042 Amendments".

## Database Changes
Migration `20261008042000_wishlist`. DB Design "v1.2 TASK-042 Amendments".

## Security / Authorization
Every endpoint needs a valid `ACTIVE` customer session (`requireCustomer`; cookie writes pass the `Origin` check). Item queries are scoped to the caller's wishlist (`404` otherwise). Inputs validated with zod; no prices accepted from clients. Writes lock the customer row (the same lock as cart writes, so move-to-cart cannot deadlock with them). Technical limit of 100 items (ADR-0041).

## Acceptance Criteria
- Guests are refused; customers add, list, remove; duplicates do not repeat.
- Out-of-stock and unavailable items stay with the right status; unknown, unpublished or archived variants cannot be added.
- Move-to-cart adds one unit (summing into an existing line) and removes the item; when the cart refuses, wishlist and cart are unchanged.
- Other customers' items are `404`.
- All required checks pass.

## Tests
- Integration `src/app/api/v1/me/wishlist/wishlist-routes.int.test.ts`: auth, add/list/remove, duplicates, refused variants, validation, Q47/Q48 statuses, limit, ownership, move-to-cart (success, retry, existing line, refusals).

## Edge Cases
- Repeated move-to-cart: the second call is `404` and the cart is not added to twice.
- Item sells out or is archived after being added: stays; move-to-cart is refused (`OUT_OF_STOCK` / `NOT_FOUND`) and the item is kept.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] R34/R35 say account deactivation removes the active cart, but say nothing about the wishlist. It is kept for now (the account can no longer sign in to see it). Decide whether deactivation removes it.
- [BUSINESS DECISION REQUIRED] Move-to-cart adds exactly one unit and removes the item from the wishlist ("move"). Confirm, or decide whether the customer picks the quantity and/or the item stays on the wishlist.
- [BUSINESS DECISION REQUIRED] Q47 offers "Coming Soon / Notify Me" for out-of-stock items; the API reports one `OUT_OF_STOCK` status. Confirm no separate "Coming Soon" state is needed (e.g. for variants never received yet, `first_goods_receipt_at` null).

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
