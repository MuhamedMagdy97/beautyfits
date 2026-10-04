# ADR-0035 — Atomic Checkout and Order Creation

- **Status:** Accepted (TASK-029)
- **Date:** 2026-10-05
- **Relates to:** ADR-0010 (transactions), ADR-0025 (inventory reservations), ADR-0031 (cart), ADR-0032 (discounts), ADR-0033 (shipping), ADR-0034 (wallet); Business Spec Q28, Q37–Q40, Q46, C1, C4, R31, R36, R37; User Flows §6.2–§6.4; Architecture §9–§10; DB Design §7–§8, §23 and "v1.2 TASK-029 Amendments"; API Contract §9, §15 and "TASK-029 Amendments"

## 1. Orders are created here, not in TASK-030

The checkout transaction must create the order (User Flows §6.3), so the `orders`, `order_items`, `order_status_history` and `checkout_attempts` tables are migrated with checkout. TASK-030 keeps the order read APIs, the status transitions, immutability guards on snapshots and the `order_id` foreign keys of `inventory_reservations`, `discount_usages` and `wallet_reservations` (their existing tests create holds for orders that do not exist).

## 2. One recomputation, two endpoints

`POST /checkout/validate` and `POST /checkout` run the same read-only calculation (`priceCheckout` in `src/server/modules/checkout/checkout-service.ts`): the cart view at current prices (ADR-0031), the chosen discount (rechecked), the shipping fee for the delivery area (R37), the wallet amount. A cart that needs review is refused with the code that says why: `PRICE_CHANGED` (Q37), `STOCK_CHANGED`, `DISCOUNT_INVALID`/`DISCOUNT_EXPIRED` (Q38), `CONFLICT CART_EMPTY`. No new error codes.

The client sends no price, only `expectedTotal`, the total the customer confirmed (User Flows §6.2 "Customer confirms"). It is compared, never used: another total is `PRICE_CHANGED` with `details.reason = TOTAL_CHANGED` and the current total.

## 3. Transaction

Inside one transaction (default isolation): lock the shopper (customer row, or the guest cart row by token hash); replay a known key; lock the cart; recompute; take an order number; create the order with items and first status; `reserveForOrder` (locks balances in variant order, `STOCK_CHANGED` when short); `recordDiscountUsage` (locks the discount, rechecks limits); `reserveWallet` (locks the wallet); mark the cart `CONVERTED`; record the checkout attempt; write the `ORDER_CREATED` outbox event. Lock order is always shopper → cart → balances → discount → wallet, so checkouts do not deadlock each other. Notifications and COD confirmation messages leave from the outbox after commit (Q40).

## 4. Choices made here (confirmed by the owner on 2026-10-05, Business Spec R38)

- **Order number:** `BF-` + a PostgreSQL sequence starting at 100001 (e.g. `BF-100001`). It never authorizes access.
- **Discount per line:** the order discount is split over the lines it targets in proportion to their line totals, rounded down, with leftover piastres to the largest remainders (`allocate` in `src/server/money/money.ts`); the shares always add up to the order discount. Returns (TASK-040) refund from these shares.
- **Status at creation:** `PENDING_CONFIRMATION`; `NEW` when the wallet pays the whole total (C4, no COD confirmation), with history reason `WALLET_COVERS_TOTAL`.
- **Guests:** name and Egyptian phone required, email optional (R31 expects guest orders without an email); inline address only; no wallet. Customers use a saved `addressId` or an inline address, and their profile as contact.
- **Tax:** prices are tax-inclusive (C1); `tax_amount` and `tax_rate` stay null until the rate is decided.
- **Cost at sale:** the variant's weighted average cost (Q103), null when it has none.
- **Rate limit:** 20 checkout requests per IP per hour (`RATE_LIMITED`), counted before any work.

## 5. Idempotency

`checkout_attempts` (DB §7) holds one row per successful checkout, unique on `(scope, idempotency_key)`, scope `CUSTOMER:<id>` or `GUEST_CART:<token hash>`. A failed checkout rolls back with its transaction, so the same key can be retried after fixing the cart. The same key and body return the original order (`201`); another body is `IDEMPOTENCY_CONFLICT`.

## Consequences

- Migration `orders_checkout`: enums `order_status`, `payment_method`, `checkout_attempt_status`; tables `orders`, `order_items`, `order_status_history` (append-only trigger), `checkout_attempts`; sequence `order_number_seq`; money checks (`total = subtotal − discount + shipping`, `cod = total − wallet`, line totals).
- `STARTED`/`FAILED` attempt statuses exist as designed but are not written yet.
- No new dependency.
