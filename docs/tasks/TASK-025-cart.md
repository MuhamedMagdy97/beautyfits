# TASK-025 — Guest & Customer Cart

## Goal
Guests and signed-in customers keep a cart of variants. The cart always shows current prices and stock, flags price changes for review, and a guest cart is merged into the customer's cart after login.

## Dependencies
TASK-014 (variants), TASK-017 (publishing), TASK-018 (selling price), TASK-019 (inventory balances), TASK-007 (customer sessions).

## Source of Truth
- Business Spec Q1 (guest cart), Q37 (price change → review), R33 (merge rule)
- User Flows §6.1, §6.2 (price-change rule)
- DB Design §7 (`carts`, `cart_items`)
- API Contract §5 (`X-Guest-Cart-Token`), §14
- ADR-0008, ADR-0013, ADR-0024, ADR-0025

## Scope
- `carts` (status `MERGED` added), `cart_items`.
- `GET /cart`, `POST /cart/items`, `PATCH|DELETE /cart/items/{cartItemId}`, `POST /cart/reprice`, `POST /cart/merge`.

## Non-Goals
- Discounts in the cart (TASK-026), shipping estimate (TASK-027), checkout and `CONVERTED` (TASK-029), wishlist move-to-cart (TASK-042), analytics events (TASK-050), guest cart expiry, website UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_cart/`
- `src/server/modules/cart/` (`cart-service.ts`, `schemas.ts`, `http.ts`), `src/server/modules/auth/tokens.ts` (`cart` token kind)
- `src/app/api/v1/cart/**`
- Docs: DB Design "v1.2 TASK-025 Amendments", API Contract "TASK-025 Amendments", ADR-0031

## Business Rules
- Q1: guests can use a cart without an account.
- Q37 / User Flows §6.2: the backend price is authoritative; a changed price must be reviewed (`priceChanged`, `requiresReview`, `reprice`).
- R33: merge adds quantities of items in both carts, capped at the available stock; items in one cart only are kept.
- Only `PUBLISHED` products are purchasable (TASK-017 note); the cart never reserves stock (TASK-020: reservation is in checkout).

## API Changes
API Contract "TASK-025 Amendments".

## Database Changes
Migration `cart`. DB Design "v1.2 TASK-025 Amendments".

## Security / Authorization
Customer requests need a valid `ACTIVE` customer session (cookie writes pass the `Origin` check); a bad credential is `401`, never a fall back to a guest cart. Guest carts are reached only through a 256-bit token stored as SHA-256. Every item query is scoped to the caller's cart (`404` otherwise). New guest carts are rate limited per IP. Inputs validated with zod. No prices are accepted from clients.

## Acceptance Criteria
- Guest: first write returns a token once; later requests with it see the same cart; unknown tokens start over.
- Add/update/remove work; adding the same variant sums; quantities above stock are refused; lowering always works; variant switch within the product (folding lines).
- Reads show current prices, `priceChanged`, stock status and `UNAVAILABLE` lines; `reprice` accepts current prices and lists changes.
- Customer: one active cart, also under concurrent first writes; merge follows R33 and is safe to retry.
- All required checks pass.

## Tests
- Integration `src/app/api/v1/cart/cart-routes.int.test.ts`: guest token lifecycle, purchasability, stock limits, validation, line limit, rate limit, quantity and variant changes, ownership, price change and reprice, unavailable lines, customer cart (including concurrency), merge (adopt, cap, never below own, guest-only lines, retry, auth).

## Edge Cases
- Unknown/malformed guest token; a guest cart merged while a guest write is in flight (a new cart is started).
- Stock dropping below a line's quantity after it was added (`INSUFFICIENT_STOCK`, lowering allowed).
- Product unpublished, variant archived or price missing after adding (`UNAVAILABLE`, excluded from the subtotal).
- Merge where the stock is below the customer's own quantity (customer's quantity kept).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- Decided by the product owner on 2026-10-04: in a merge the stock cap never lowers the customer's own quantity (R33 clarification, ADR-0031 §4).
- `[BUSINESS DECISION REQUIRED]` Guest cart retention: how long an inactive guest cart (and an inactive customer cart) is kept before `ABANDONED`/`EXPIRED`. Until decided, carts stay `ACTIVE`.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
