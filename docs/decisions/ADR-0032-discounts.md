# ADR-0032 — Discount Engine

- **Status:** Accepted (TASK-026); the application rules (Business Spec R36) were decided by the product owner on 2026-10-04
- **Date:** 2026-10-04
- **Relates to:** ADR-0018 (audit), ADR-0031 (cart); Business Spec Q38, Q125, Q131–Q138, R9, R36; User Flows §6.2; DB Design §14 and "v1.2 TASK-026 Amendments"; API Contract §14, §23 and "TASK-026 Amendments"

## 1. Model

- `discounts`: percentage only (Q131), whole percent 1–100, `scope` `STORE_WIDE` or `TARGETED`. Targets are link tables `discount_products`, `discount_categories`, `discount_brands`; a targeted discount needs at least one, a store-wide one none. An item matches when its product, brand or one of its categories (or an ancestor of it, R36) is linked.
- `code` nullable: stored uppercase, unique, matched ignoring case. Without a code the discount is an offer listed in the cart.
- Created `INACTIVE`; `activate` / `deactivate` switch `status` (idempotent). Never deleted (trigger). Editable at any time; orders snapshot what they used (`orders.discount_snapshot_json`, TASK-030). Create, edit, activate and deactivate are audited (`DISCOUNT_*`).
- `discount_usages`: one row per order (`order_id` unique; the foreign key to `orders` comes with TASK-030), `released_at` when the use is given back. Limits count rows with `released_at IS NULL`.

## 2. Engine

- `evaluateDiscount` (`src/server/modules/discounts/engine.ts`) is pure. Checks in order: active, started, not ended, overall limit, per-customer limit (a guest gets `SIGN_IN_REQUIRED`), at least one targeted purchasable line, minimum order total against the subtotal of all purchasable lines.
- Amount: the percentage of the targeted purchasable subtotal, computed exactly and rounded once HALF-UP (R9), then capped by `max_discount_amount`. Unavailable lines never count (Q137). Per-line allocation for order items is TASK-030's job.

## 3. Cart

- `carts.discount_id` holds the shopper's choice. `PUT /cart/discount` takes `{ code }` or `{ discountId }` (codeless offers only, so ids never reveal coded discounts) and refuses a discount that does not apply now (`DISCOUNT_INVALID` with `details.reason`, `DISCOUNT_EXPIRED` once ended). `DELETE /cart/discount` clears it.
- Every read re-evaluates the choice: if it no longer applies the cart shows `discountProblem` (not counted, `requiresReview` true) without writing; `POST /cart/reprice` then clears it and reports `discountRemoved` (Q38). Reads also list `availableDiscounts`: running codeless offers that apply now. Nothing is chosen automatically (Q138).
- Merge: the customer's own choice wins, otherwise the guest's carries over.
- Unknown codes are throttled: 20 per IP per 15 minutes (`rate_limit_buckets`, key `discount:code:ip:<ip>`), against code guessing.

## 4. Usage

- `recordDiscountUsage(tx, …)` runs inside the checkout transaction (TASK-029): it locks the discount row, re-checks the limits and inserts the use, so concurrent orders cannot pass a limit. `releaseDiscountUsage(tx, orderId)` (TASK-031/033: cancellation or expiry before shipping) sets `released_at`; it is idempotent.

## Consequences

- Migration `discounts`: enums `discount_status`, `discount_type`, `discount_scope`; tables `discounts`, `discount_products`, `discount_categories`, `discount_brands`, `discount_usages`; `carts.discount_id`; checks and the no-delete trigger.
- System-suggested promotions for low-demand products (Q132, with approval) wait for analytics (TASK-050/051).
- No new dependency.
