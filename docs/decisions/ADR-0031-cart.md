# ADR-0031 — Guest and Customer Cart

- **Status:** Accepted (TASK-025); the merge cap of §4 was confirmed by the product owner on 2026-10-04
- **Date:** 2026-10-04
- **Relates to:** ADR-0008/ADR-0013 (opaque tokens, customer sessions, throttling), ADR-0024/ADR-0025 (inventory balances); Business Spec Q37, R33; User Flows §6.1; DB Design §7 and "v1.2 TASK-025 Amendments"; API Contract §14 and "TASK-025 Amendments"

## 1. Ownership and tokens

- One table `carts` for both owners: a customer cart (`customer_id`) or a guest cart (`guest_token_hash`), never both (check constraint). A customer has at most one `ACTIVE` cart (partial unique index); writes lock the customer row before finding or creating it.
- The guest token is an opaque token (`bfc_` + 256 random bits, as the other tokens of ADR-0008). Only its SHA-256 is stored. It travels in `X-Guest-Cart-Token`, so a guest cart has no ambient credential and needs no CSRF check.
- A request with a customer credential always uses the customer cart; a bad credential is refused rather than falling back to the guest cart.

## 2. Prices and stock

- The cart stores intent: variant, quantity and `last_seen_unit_price`. Reads compute the current price, line totals and stock status; nothing is trusted later — checkout (TASK-029) revalidates.
- Q37: a current price different from `last_seen_unit_price` shows `priceChanged` and `requiresReview` until `POST /cart/reprice` accepts the current prices. Adding an item, or switching a line's variant, sets `last_seen_unit_price` to the price shown at that moment.
- A cart does not reserve stock (reservation happens in the checkout transaction, ADR-0025). Adding, raising a quantity or switching variant is refused (`OUT_OF_STOCK`) above `available_quantity`; lowering is always allowed. Lines whose product leaves `PUBLISHED`, whose variant is archived or that lose their price stay in the cart as `UNAVAILABLE` so the shopper sees what happened.

## 3. Technical limits (not business rules)

- Quantity 1–999 per request (input bound only; stock is the real limit).
- 50 different items per cart, checked when a new line is added. A merge may go beyond it, because R33 keeps every item.
- 30 new guest carts per IP per hour (`rate_limit_buckets`, key `cart:create:ip:<ip>`), so anonymous clients cannot fill the table.

## 4. Merge after login (R33)

- `POST /cart/merge` (customer session + guest token), in one transaction holding the customer row and the guest cart locks.
- No customer cart: the guest cart is adopted (`customer_id` set, token hash cleared).
- Otherwise each guest line is added to the customer cart. For an item in both carts the new quantity is `max(own, min(own + guest, available))`: the sum, capped at the available stock, and the cap never takes away what the customer already had (R33 caps the addition; it does not say to reduce the customer's own line). Items in one cart only are copied as they are. The guest cart becomes `MERGED` and keeps its lines as history.
- An unknown, malformed or already merged token returns the customer cart unchanged, so the call is safe to retry.

## Consequences

- Migration `cart`: enum `cart_status` (with `MERGED`), `carts`, `cart_items`, check constraints.
- Retention (R35, decided 2026-10-04): every guest lookup ignores a guest cart whose `updated_at` is older than the setting `cart.guest_expiry_days` (default 30), so the rule holds without a scheduler; `npm run jobs:expire-guest-carts` (`expireGuestCarts`) marks those carts `EXPIRED` and is scheduled daily by TASK-066. Customer carts never expire. Deactivation (R34) deletes the customer's active cart. `ABANDONED` is left to TASK-050.
- Discounts in the cart and reprice come with TASK-026, shipping with TASK-027; TASK-029 marks the cart `CONVERTED`; TASK-042 (move to cart) reuses `addItem`; analytics add-to-cart events come with TASK-050.
- No new dependency.
