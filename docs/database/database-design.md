# BeautyFits — Database Design v1.2

**Status:** Approved v1.2 — owner review completed in TASK-002A (2026-09-30). Items marked `[BUSINESS DECISION REQUIRED]` remain open and must be answered before their owning task. The review checklist below is verified by the tests of each implementing task.\
**Depends on:** Business Specification v1.1 + User Flows / State Machines v1.1 + System Architecture v1.1\
**Purpose:** Define the PostgreSQL transactional model before API implementation or migrations.

## 1. Database Principles

1. PostgreSQL is the transactional source of truth.
2. Business rules are enforced in the backend and, where appropriate, with database constraints/transactions.
3. Money is stored as integer minor units (EGP piastres, e.g. `bigint`), never floating point. Every monetary column in this document (prices, costs, totals, fees, discount amounts, wallet amounts, refunds, supplier amounts) is an integer minor-unit value accompanied by a currency where relevant. Non-money numeric values (percentages, tax rates, quantities) are not minor units. Derived amounts are computed with exact decimal/rational arithmetic and the final stored value is rounded to the nearest piastre using HALF-UP (Business Spec R9).
4. Important historical values are snapshotted on transactional records.
5. Inventory is ledger-driven; wallet is ledger-driven.
6. Orders, shipping, and returns are related but have separate state concerns.
7. Hard deletion is prohibited for historical business records.
8. External files live in object storage; PostgreSQL stores metadata/references.
9. IDs should be opaque, stable identifiers (UUID recommended).
10. All timestamps are stored in UTC; presentation timezone is handled by the application. Calendar-day business concepts use the business timezone Africa/Cairo (Business Spec R20).

---

## 2. Domain / Ownership Map

| Domain | Core Tables |
|---|---|
| Identity & Customers | accounts, customers, customer_addresses, marketing_consents, auth_sessions, otp_challenges |
| Employees & RBAC | employees, roles, permissions, role_permissions, employee_roles, employee_invitations, approval_requests |
| Catalog | products, product_variants, categories, brands, product_categories, product_media |
| Cart & Checkout | carts, cart_items, checkout_attempts |
| Orders | orders, order_items, order_status_history, order_revisions, cod_confirmation_tokens |
| Shipping | shipping_companies, shipping_rules, shipments, shipment_events, customer_contact_tasks |
| Inventory | inventory_balances, inventory_movements, inventory_reservations |
| Purchasing | suppliers, purchase_orders, purchase_items, goods_receipts, goods_receipt_items, purchase_invoices, supplier_returns, supplier_return_items, supplier_ledger_entries, supplier_payments |
| Returns | returns, return_items, return_inspections, return_evidence |
| Wallet | wallets, wallet_transactions, wallet_reservations |
| Discounts | discounts, discount_usages |
| Wishlist | wishlists, wishlist_items, restock_subscriptions |
| Reviews | reviews |
| Notifications | notifications, notification_deliveries |
| Marketing | campaigns, campaign_recipients |
| Analytics | analytics_events |
| Audit & Settings | audit_logs, settings, setting_history |
| Media | media_assets |
| Reliability (shared kernel) | idempotency_keys, outbox_events |

---

## 3. Identity & Customer Model

### 3.1 `accounts`

Authentication identity shared by customer/employee authentication infrastructure.

Key fields:
- `id`
- `account_type` = `CUSTOMER` | `EMPLOYEE`
- `email`
- `email_verified_at`
- `password_hash`
- `status` = `PENDING_VERIFICATION` | `ACTIVE` | `SUSPENDED` | `DEACTIVATED` (`PENDING_VERIFICATION` added in TASK-007, Business Spec R25)
- `last_login_at`
- `created_at`, `updated_at`

Constraints:
- normalized email is unique **per `account_type`** (the same email may hold one CUSTOMER and one EMPLOYEE account; Business Spec R15), **among verified emails only** (partial unique index; unverified pending registrations never reserve an email — Business Spec R25, TASK-007)
- password hashes only; never plaintext passwords
- customers log in with email + password (Business Spec R13); `deactivated_at` and `anonymized_at` support Q154 (v1.2 amendments)

### 3.2 `customers`

Key fields:
- `id`
- `account_id` nullable for guest-only historical customers if needed
- `phone` (Egyptian mobile number normalized to E.164 — Business Spec R27; required; unique among **active** accounts only (Business Spec R25, R30); primary business identifier, not the login — Business Spec R13)
- `phone_verified_at` nullable. Since R30 there is no phone OTP: it is set when the account becomes `ACTIVE` (email verified), meaning the phone is confirmed for this account, so the partial unique index on verified phones keeps working.
- `preferred_locale` = `ar` | `en` (Business Spec R14)
- `full_name`
- `date_of_birth` nullable
- `status`
- `created_at`, `updated_at`

A guest order can exist without a customer account. A verified account can later claim eligible guest orders through an explicit linking flow.

### 3.3 `customer_addresses`

Key fields:
- `id`
- `customer_id`
- `label`
- `recipient_name`
- `phone`
- `governorate`
- `city`
- `area`
- `street`
- `building`
- `floor`
- `apartment`
- `landmark`
- `notes`
- `is_default`
- `created_at`, `updated_at`

Rules:
- multiple addresses per customer
- at most one default address per customer
- editing an address never mutates an existing order's snapshot

### 3.4 Marketing consent

**Superseded in v1.2 (TASK-002A):** `customer_marketing_preferences` is removed. Marketing consent is stored only in `marketing_consents` (see "v1.2 TASK-002A Amendments"), which keeps the full opt-in/opt-out history per channel; the current state is the latest row per customer and channel.

Never infer marketing consent from simply having an email/phone number.

---

## 4. Employee & RBAC Model

### `employees`

Fields:
- `id`
- `account_id`
- `display_name`
- `employee_level` = `OWNER` | `ADMIN` | `MANAGER` | `EMPLOYEE`
- `department`
- `status` = `ACTIVE` | `DEACTIVATED`
- `created_by_employee_id`
- `deactivated_at`
- `created_at`, `updated_at`

### `roles`

Fields:
- `id`
- `name`
- `description`
- `is_system_role`

### `permissions`

Fields:
- `id`
- `code` (unique)
- `description`

Examples:
- `PRODUCT_EDIT`
- `EDIT_PRODUCT_PRICE`
- `MANAGE_PRODUCT_MEDIA`
- `ADJUST_INVENTORY`
- `CONFIRM_ORDER`
- `START_PREPARING`
- `MARK_AS_SHIPPED`
- `CANCEL_ORDER`
- `MANAGE_MANUAL_REFUNDS`
- `ADJUST_WALLET`
- `VIEW_AUDIT_LOGS`

### `employee_roles`

Fields:
- `employee_id`
- `role_id`
- `assigned_by_employee_id`
- `assigned_at`

### `role_permissions`

Composite unique key:
- `role_id + permission_id`

Rules:
- Owner has full access.
- Admin cannot create or modify ownership.
- Manager may create employees only within allowed scope and cannot grant roles/permissions above their own authority.
- Employee cannot assign roles by default.
- Deactivating an employee never deletes historical references.

---

## 5. Catalog Model

### `products`

Core fields:
- `id`
- `name_ar`, `name_en`
- `slug` (unique, Latin characters)
- `description_ar`, `description_en`
- `brand_id`
- `status` = `DRAFT` | `PUBLISHED` | `ARCHIVED` | `DISABLED`
- `created_at`, `updated_at`, `archived_at`

v1.2 (TASK-002A): SKU, selling price, costs and stock thresholds are **not** product fields; they live on `product_variants` (C6). The main image is identified only by `product_media.is_main` (no `main_media_id`).

Low-stock threshold level: decided 2026-10-02 (ADR-0024 §4 item 2) — an optional threshold on the product applies to its variants; a variant may override it. See "v1.2 TASK-019 Amendments".

Rules:
- hard delete prohibited
- product remains available for historical references after archive
- public product may be visible while out of stock

### `product_variants`

Used for shades, sizes, volumes, pack types, etc.

Fields:
- `id`
- `product_id`
- `sku` (unique)
- `is_default` (exactly one default variant per product; C6)
- `variant_name_ar`, `variant_name_en`
- `attributes_json`
- `status`
- `selling_price`
- `latest_purchase_cost`
- `weighted_average_cost`
- `low_stock_threshold`

Every product has at least one variant; a product without visible options has exactly one Default Variant (C6).

### `brands`

Fields:
- `id`
- `name_ar`, `name_en`
- `slug`
- `description_ar`, `description_en`
- `status`

### `categories`

Fields:
- `id`
- `name_ar`, `name_en`
- `slug`
- `parent_id` nullable
- `status`

### `product_categories`

Many-to-many link:
- `product_id`
- `category_id`

### `product_media`

Fields:
- `id`
- `product_id`
- `variant_id` nullable
- `media_asset_id`
- `sort_order`
- `is_main` (at most one per product)
- `alt_text_ar`, `alt_text_en`
- `created_at`

Rules:
- main image required for publishable product (Q178). A Draft may exist without one (decided 2026-10-01, ADR-0021 §5 item 6; User Flows §4.1 "every product" applies from publishing on)
- media management requires explicit permission

---

## 6. Media Storage

### `media_assets`

Fields:
- `id`
- `storage_provider`
- `object_key`
- `original_filename`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `checksum`
- `scan_status` = `PENDING` | `SAFE` | `REJECTED`
- `created_by_employee_id` nullable
- `created_at`

Binary data is not stored in PostgreSQL.

---

## 7. Cart & Checkout

### `carts`

Fields:
- `id`
- `customer_id` nullable
- `guest_token` nullable
- `status` = `ACTIVE` | `CONVERTED` | `ABANDONED` | `EXPIRED`
- `currency`
- `created_at`, `updated_at`

Exactly one of `customer_id` or `guest_token` identifies the cart owner. Migrated by TASK-025 (see "v1.2 TASK-025 Amendments": the token is stored hashed, status `MERGED` added).

### `cart_items`

Fields:
- `id`
- `cart_id`
- `product_variant_id`
- `quantity`
- `last_seen_unit_price`
- `created_at`, `updated_at`

Cart quantities are revalidated at checkout.

### `checkout_attempts`

Fields:
- `id`
- `idempotency_key` unique per authenticated/guest checkout scope
- `cart_id`
- `result_order_id` nullable
- `status` = `STARTED` | `SUCCEEDED` | `FAILED`
- `request_fingerprint`
- `created_at`, `completed_at`

Purpose: prevent duplicate orders when client retries due to network errors.

---

## 8. Orders

### `orders`

Core fields:
- `id`
- `order_number` human-readable unique value
- `customer_id` nullable
- `guest_email`
- `guest_phone`
- `status` = `PENDING_CONFIRMATION` | `NEW` | `CONFIRMED` | `PREPARING` | `READY_FOR_SHIPMENT` | `SHIPPED` | `DELIVERED` | `CANCELLED` | `EXPIRED`
  - `OUT_FOR_DELIVERY`, delivery failure, return-to-sender, and shipping cancellation requests are Shipment-level (see `shipments`), not Order statuses.
- `payment_method` = `COD`
- `currency`
- `subtotal`
- `discount_total`
- `shipping_fee`
- `wallet_amount_reserved`
- `total`
- `billing_snapshot_json`
- `shipping_address_snapshot_json`
- `customer_snapshot_json`
- `cod_confirmation_source` nullable = `WHATSAPP` (WhatsApp secure-link confirmation) | `PHONE` (staff-recorded). SMS is a future value; there is no `SECURE_LINK` value in the MVP (Business Spec R10).
- `cod_confirmed_at` nullable
- `cod_confirmation_recorded_by_employee_id` nullable — required when source is `PHONE`; the recording is also written to `audit_logs`
- `confirmed_at`
- `delivered_at`
- `cancelled_at`
- `expired_at`
- `created_at`, `updated_at`

Important: snapshots are immutable historical records.

### `order_items`

Fields:
- `id`
- `order_id`
- `product_id`
- `product_variant_id`
- `sku_snapshot`
- `product_name_snapshot`
- `variant_name_snapshot`
- `image_snapshot`
- `unit_price`
- `unit_cost_at_sale`
- `quantity`
- `discount_amount`
- `line_total`
- `created_at`

`unit_cost_at_sale` exists to make historical gross-profit calculations independent from future cost changes.

### `order_status_history`

Fields:
- `id`
- `order_id`
- `from_status`
- `to_status`
- `changed_by_type` = `SYSTEM` | `EMPLOYEE` | `CUSTOMER`
- `changed_by_id` nullable
- `reason` nullable/required depending on transition
- `created_at`

---

## 9. Shipping

### `shipping_companies`

Fields:
- `id`
- `name`
- `code`
- `contact_info`
- `status`

### `shipping_rules`

Fields:
- `id`
- `shipping_company_id` nullable
- `governorate` nullable
- `area` nullable
- `min_order_total` nullable
- `max_order_total` nullable
- `shipping_fee`
- `free_shipping` boolean
- `priority`
- `active_from`
- `active_to`
- `status`

The final free-shipping rule is evaluated against the final order total after applicable product discounts.

Governorate/area representation: a managed location list shared by addresses and shipping rules (Business Spec R32); `governorate`/`area` become `governorate_id`/`area_id` (see "v1.2 TASK-009 Amendments").

### `shipments`

Fields:
- `id`
- `order_id`
- `shipping_company_id`
- `tracking_number`
- `status` = `PENDING` | `READY` | `SHIPPED` | `OUT_FOR_DELIVERY` | `DELIVERY_FAILED` | `RETURN_TO_SENDER` | `RETURNED` | `DELIVERED`
- `attempt_count`
- `picked_up_at`
- `delivered_at`
- `returned_at`
- `created_at`, `updated_at`

### `shipment_events`

Fields:
- `id`
- `shipment_id`
- `event_type`
- `event_at`
- `location` nullable
- `raw_provider_reference` nullable
- `notes`

This isolates delivery state from the order's commercial lifecycle.

A shipping cancellation request (after carrier pickup) is recorded as a `shipment_events` entry (e.g. `event_type = SHIPPING_CANCELLATION_REQUESTED`) plus an audit log; it does not change `orders.status`. The shipment then moves to `RETURN_TO_SENDER` → `RETURNED`, and the order moves `SHIPPED → CANCELLED` only after the returned shipment is inspected.

---

## 10. Inventory

### `inventory_balances`

One row per sellable variant.

Fields:
- `product_variant_id` unique
- `available_quantity`
- `reserved_quantity`
- `damaged_quantity`
- `updated_at`

Business invariant:
- sellable quantity = available quantity
- reserved quantity is not sellable
- damaged quantity is not sellable

### `inventory_reservations`

Fields:
- `id`
- `order_id`
- `product_variant_id`
- `quantity`
- `status` = `ACTIVE` | `RELEASED` | `CONVERTED`
- `reserved_at`
- `released_at`

Unique/locking strategy must prevent two concurrent checkouts from reserving the same last units.

Decided 2026-10-03 (ADR-0025): a reservation is consumed (`CONVERTED`) when the order is `SHIPPED`; reserving, releasing and consuming each write `inventory_movements` rows. See "v1.2 TASK-020 Amendments".

### `inventory_movements`

Fields:
- `id`
- `product_variant_id`
- `movement_type`
- `quantity_delta`
- `reference_type`
- `reference_id`
- `unit_cost` nullable
- `reason` nullable
- `created_by_type`
- `created_by_id` nullable
- `created_at`

Examples:
- PURCHASE_RECEIPT
- CUSTOMER_ORDER_COMMIT
- CUSTOMER_RETURN_RESTOCK
- SUPPLIER_RETURN
- MANUAL_ADJUSTMENT
- DAMAGE
- RELEASE_RESERVATION

Every stock-affecting operation creates a movement record.

---

## 11. Suppliers & Purchasing

### `suppliers`

Fields:
- `id`
- `name`
- `phone`
- `email`
- `address`
- `notes`
- `status`

### `purchase_orders`

Fields:
- `id`
- `purchase_number`
- `supplier_id`
- `status` = `DRAFT` | `PENDING_APPROVAL` | `APPROVED` | `SENT` | `PARTIALLY_RECEIVED` | `RECEIVED` | `CLOSED` | `CANCELLED`
- `ordered_total`
- `notes`
- `invoice_media_id` nullable
- `created_by_employee_id`
- `approved_by_employee_id` nullable
- `approved_at`
- `created_at`, `updated_at`

### `purchase_items`

Fields:
- `id`
- `purchase_order_id`
- `product_variant_id`
- `ordered_quantity`
- `unit_cost`
- `line_total`

### `goods_receipts`

Fields:
- `id`
- `purchase_order_id`
- `receipt_number`
- `status` = `PENDING_INSPECTION` | `APPROVED` | `REJECTED` | `PARTIALLY_APPROVED`
- `received_by_employee_id`
- `reviewed_by_employee_id`
- `received_at`
- `notes`

### `goods_receipt_items`

Fields:
- `id`
- `goods_receipt_id`
- `purchase_item_id`
- `delivered_quantity`
- `accepted_quantity`
- `damaged_quantity`
- `over_delivery_quantity`
- `inspection_notes`

Rules:
- ordered quantity, received quantity, and invoiced quantity are separate facts
- under-delivery is recorded; do not mutate the original invoice/history
- over-delivery requires approval before extra quantity enters available stock

### `supplier_returns`

Fields:
- `id`
- `supplier_id`
- `purchase_order_id`
- `status` = `DRAFT` | `PENDING_APPROVAL` | `APPROVED` | `SHIPPED` | `RECEIVED_BY_SUPPLIER` | `SETTLED`
- `reason`
- `financial_resolution` = `REFUND` | `CREDIT` | `OTHER`
- `financial_amount` nullable
- `approved_by_employee_id`
- `created_at`, `updated_at`

### `supplier_return_items`

Fields:
- `id`
- `supplier_return_id`
- `product_variant_id`
- `quantity`
- `purchase_item_id` nullable
- `unit_cost`
- `reason`

---

## 12. Returns

### `returns`

Fields:
- `id`
- `return_number`
- `order_id`
- `customer_id` nullable
- `status` = `PENDING_APPROVAL` | `APPROVED` | `PICKUP_SCHEDULED` | `RECEIVED` | `INSPECTING` | `PARTIALLY_COMPLETED` | `COMPLETED` | `REJECTED` | `CANCELLED`
- `customer_reason_text`
- `final_responsibility` = `CUSTOMER` | `BEAUTYFITS` | `CARRIER` | `UNDETERMINED`
- `return_shipping_fee`
- `refund_total`
- `approved_by_employee_id`
- `approved_at`
- `received_at`
- `completed_at`
- `created_at`, `updated_at`

Rule: a return may be requested until the end of the 14th calendar day after the delivery date in Africa/Cairo; the delivery day is day 0 (Business Spec R21).

### `return_items`

Fields:
- `id`
- `return_id`
- `order_item_id`
- `requested_quantity`
- `accepted_quantity`
- `rejected_quantity`
- `refund_eligible_amount`
- `deduction_amount`
- `resolution` = `RESTOCK` | `DAMAGED` | `REJECTED` | `RETURN_TO_CUSTOMER`
- `notes`

### `return_inspections`

Fields:
- `id`
- `return_item_id`
- `inspected_by_employee_id`
- `condition` = `SELLABLE` | `DAMAGED` | `OPENED_USED` | `MISSING_PARTS` | `REJECTED`
- `result` = `RESTOCK` | `DAMAGED` | `REJECTED` | `RETURN_TO_CUSTOMER`
- `notes`
- `created_at`

Customer-caused opened/used resolution:
- Return-to-customer with no refund, OR
- BeautyFits keeps product and issues the partial Wallet refund defined in Business Spec R7 (policy percentage is a configurable setting); the resolution and `deduction_amount` are recorded explicitly and in `audit_logs`.

### `return_evidence`

Fields:
- `id`
- `return_id`
- `media_asset_id`
- `evidence_type`
- `uploaded_by_type`
- `uploaded_by_id`
- `created_at`

For damage/wrong-item scenarios, evidence upload can be required by business rules.

---

## 13. Wallet

### `wallets`

Fields:
- `id`
- `customer_id` unique
- `currency`
- `balance`
- `created_at`, `updated_at`

`balance` is a cached/materialized value; ledger remains authoritative for audit/reconciliation.

### `wallet_transactions`

Fields:
- `id`
- `wallet_id`
- `transaction_type`
- `amount`
- `direction` = `CREDIT` | `DEBIT`
- `reference_type`
- `reference_id`
- `reason`
- `created_at`

Examples:
- RETURN_REFUND
- ORDER_WALLET_USE
- MANUAL_ADJUSTMENT
- REVERSAL

### `wallet_reservations`

Fields:
- `id`
- `wallet_id`
- `order_id`
- `amount`
- `status` = `ACTIVE` | `CAPTURED` | `RELEASED`
- `created_at`
- `released_at`

For wallet + COD orders, wallet funds are reserved until the order outcome is known.

---

## 14. Discounts

### `discounts`

Fields:
- `id`
- `code` nullable for automatic/internal discounts
- `name`
- `discount_type` = `PERCENTAGE`
- `value`
- `max_discount_amount` nullable
- `minimum_order_total` nullable
- `starts_at`
- `ends_at`
- `usage_limit_total` nullable
- `usage_limit_per_customer` nullable
- `status` (v1.2: the duplicate `active` flag is removed)
- `created_by_employee_id`

v1 rule: one discount per order. Customer selects the eligible discount when multiple are available.

### Discount targeting

A flexible targeting structure can use explicit link tables rather than stuffing all targeting into one JSON blob:
- `discount_products`
- `discount_categories`
- `discount_brands`

An internal discount engine evaluates eligibility at checkout.

### `discount_usages`

Fields:
- `id`
- `discount_id`
- `customer_id` nullable
- `order_id`
- `discount_amount`
- `used_at`

Unique constraints should prevent duplicate usage beyond configured limits.

---

## 15. Wishlist & Restock

### `wishlists`

One active wishlist per customer.

Fields:
- `id`
- `customer_id` unique
- `created_at`, `updated_at`

### `wishlist_items`

Fields:
- `id`
- `wishlist_id`
- `product_variant_id`
- `created_at`

Unique: `wishlist_id + product_variant_id`

Guests cannot access wishlists.

### `restock_subscriptions`

Explicit `Notify Me` subscriptions independent from merely having an item in Wishlist.

Fields:
- `id`
- `customer_id`
- `product_variant_id`
- `email_enabled`
- `whatsapp_enabled`
- `status` = `ACTIVE` | `FULFILLED` | `CANCELLED`
- `subscribed_at`
- `fulfilled_at`

One successful restock event triggers one notification per active subscription; after fulfillment the subscription is closed.

---

## 16. Reviews

### `reviews`

Fields:
- `id`
- `customer_id`
- `product_variant_id` or `product_id` according to review granularity decision
- `order_item_id`
- `rating` 1–5
- `body`
- `status` = `PUBLISHED` | `HIDDEN` | `REPORTED`
- `moderation_reason` nullable
- `created_at`, `updated_at`

Rules:
- verified purchase required
- one review per successful purchase/order item
- reviews publish immediately after automated/abuse checks
- admin can hide later; hiding must not delete history
- review images are not included in v1

---

## 17. Notifications

### `notifications`

In-app notification centre for customers and employees (v1.2). Guests have no in-app centre; their transactional messages exist only as `notification_deliveries` (see v1.2 amendments).

Fields:
- `id`
- `recipient_type` = `CUSTOMER` | `EMPLOYEE`
- `customer_id` nullable
- `employee_id` nullable
- `type` = `TRANSACTIONAL` | `MARKETING` | `RESTOCK`
- `title`
- `body`
- `deep_link_type` nullable
- `deep_link_id` nullable
- `read_at` nullable
- `created_at`

### `notification_deliveries`

Fields:
- `id`
- `notification_id`
- `channel` = `EMAIL` | `WHATSAPP`
- `recipient`
- `attempt_number`
- `status` = `PENDING` | `SENT` | `FAILED` | `FALLBACK_SENT`
- `provider_reference` nullable
- `failure_reason` nullable
- `sent_at`

Notification policy is determined by notification type + consent/preferences.

---

## 18. Marketing Campaigns

### `campaigns`

Fields:
- `id`
- `name`
- `type` = `WHATSAPP` | `EMAIL`
- `status` = `DRAFT` | `PENDING_APPROVAL` | `APPROVED` | `SENDING` | `COMPLETED` | `FAILED` | `CANCELLED`
- `subject` nullable
- `content`
- `created_by_employee_id`
- `approved_by_employee_id` nullable
- `approved_at` nullable
- `created_at`, `updated_at`

### `campaign_recipients`

Fields:
- `id`
- `campaign_id`
- `customer_id`
- `eligibility_snapshot_json`
- `channel`
- `status`
- `sent_at` nullable
- `failure_reason` nullable

Do not treat an audience query as a consent substitute; recipients must already be eligible.

---

## 19. Analytics

### `analytics_events`

Fields:
- `id`
- `anonymous_id` nullable
- `customer_id` nullable
- `session_id` nullable
- `event_type`
- `entity_type` nullable
- `entity_id` nullable
- `metadata_json`
- `occurred_at`

Key event types:
- PAGE_VIEW
- PRODUCT_VIEW
- ADD_TO_CART
- CHECKOUT_STARTED
- ORDER_CREATED
- ORDER_CONFIRMED
- ORDER_DELIVERED
- RETURN_REQUESTED

Analytics is not authoritative for orders, inventory, or wallet.

---

## 20. Audit & Settings

### `audit_logs`

Fields:
- `id`
- `actor_type` = `SYSTEM` | `EMPLOYEE` | `CUSTOMER`
- `actor_id` nullable
- `action`
- `entity_type`
- `entity_id`
- `previous_data_json` nullable
- `new_data_json` nullable
- `reason` nullable
- `correlation_id` nullable
- `created_at`

Important actions include:
- price changes
- stock adjustments
- order status changes
- manual refunds
- wallet adjustments
- return decisions
- permission changes
- critical settings changes

Audit rows are append-only to ordinary users.

### `settings`

Fields:
- `key` unique
- `value_json`
- `data_type`
- `updated_by_employee_id`
- `updated_at`

Examples:
- free shipping threshold
- COD timeout/default and maximum
- low stock defaults
- restock/reminder limits
- return policy configuration where allowed

### `setting_history`

Fields:
- `id`
- `setting_key`
- `old_value_json`
- `new_value_json`
- `changed_by_employee_id`
- `approved_by_employee_id` nullable
- `created_at`

Critical settings require Owner/Admin approval according to business workflow.

---

## 21. Key Relationships

```text
Account 1─1 Customer
Account 1─1 Employee
Customer 1─N Address
Customer 1─N Orders
Customer 1─1 Wallet
Customer 1─1 Wishlist
Customer 1─N Reviews
Customer 1─N Returns

Product 1─N Variants
Product N─N Categories
Product N─1 Brand
Product/Variant 1─N Media

Cart 1─N CartItems
CheckoutAttempt 1─0..1 Order
Order 1─N OrderItems
Order 1─N StatusHistory
Order 1─N Shipments (allow future split shipments)
Order 1─N Returns

Variant 1─1 InventoryBalance
Variant 1─N InventoryMovements
Variant 1─N InventoryReservations

Supplier 1─N PurchaseOrders
PurchaseOrder 1─N PurchaseItems
PurchaseOrder 1─N GoodsReceipts
GoodsReceipt 1─N GoodsReceiptItems
PurchaseOrder 1─N SupplierReturns

Return 1─N ReturnItems
ReturnItem 1─N Inspections
Return 1─N Evidence

Wallet 1─N WalletTransactions
Wallet 1─N WalletReservations

Discount 1─N DiscountUsages
Customer 1─N DiscountUsages

Notification 1─N NotificationDeliveries
Campaign 1─N CampaignRecipients

Employee 1─N AuditLogs
```

---

## 22. Critical Constraints & Indexes

### Uniqueness
- normalized account email per account type, once verified (R15, R25)
- customer phone, once verified (R25)
- product SKU
- variant SKU
- product slug
- brand slug
- category slug within parent scope
- order number
- purchase number
- return number
- tracking number scoped by shipping company where appropriate
- wallet per customer
- active wishlist per customer

### High-value indexes
- orders: `(customer_id, created_at desc)`
- orders: `(status, created_at)`
- orders: `(created_at)`
- order_items: `(order_id)`
- order_items: `(product_variant_id)`
- inventory_reservations: `(product_variant_id, status)`
- inventory_movements: `(product_variant_id, created_at desc)`
- shipments: `(tracking_number)`
- returns: `(customer_id, created_at desc)`
- returns: `(status, created_at)`
- notifications: `(customer_id, read_at, created_at desc)`
- notification_deliveries: `(status, created_at)`
- analytics_events: `(event_type, occurred_at)`
- audit_logs: `(entity_type, entity_id, created_at desc)`

Indexes should be validated against actual query plans after implementation rather than creating dozens of speculative indexes.

---

## 23. Transaction Boundaries

### Checkout transaction
Must atomically:
- validate authoritative prices/stock before mutation
- create order
- create order items
- create inventory reservations
- create wallet reservation if applicable
- create initial status history
- persist checkout attempt result

External messages/integrations occur after commit.

### Order expiration/cancellation
Must atomically:
- change order state
- release inventory reservations
- release wallet reservation if applicable
- create movement/history records

### Delivery confirmation
Must atomically:
- mark shipment/order delivery state
- create history
- make Return eligibility available according to delivery timestamp

### Return completion
Must atomically:
- persist inspection result
- add sellable quantities to inventory when restocked
- create inventory movement
- create wallet refund transaction
- finalize return state

### Purchase receiving
Must atomically:
- finalize accepted receipt quantities
- create inventory movements
- update purchase/receipt status
- record discrepancies

---

## 24. Historical / Snapshot Rules

Order records are immutable historical facts except for controlled lifecycle fields.

Keep snapshots for:
- customer name/phone/email at order time
- shipping address at order time
- product name/variant/SKU at order time
- product image reference/snapshot at order time
- selling price at order time
- discount applied
- unit cost at sale
- shipping fee/rule outcome

Do not rebuild historical orders from current product/customer records.

---

## 25. Deferred / Intentionally Flexible

The following remain implementation decisions after this schema review:
- ORM and migration tool
- exact enum representation vs lookup tables
- exact ID generation strategy (UUID/UUIDv7 or equivalent)
- exact JSON column usage limits
- exact payment provider schema for future online payments
- exact shipping provider webhook format
- exact queue implementation
- exact object-storage provider

These should not change the business semantics defined above.

**Resolved in TASK-002:** ORM and migration tool are Prisma ORM 7 (`@prisma/adapter-pg`) and Prisma Migrate, with SQL migrations committed under `prisma/migrations/` and applied with `prisma migrate deploy` outside development. Schema conventions (minor-unit money, UUID ids, UTC timestamps, `snake_case` mapping) are recorded in `docs/decisions/ADR-0003-database-access-and-migrations.md`. No tables exist yet; TASK-003 creates the first migration. TASK-003 (ADR-0010): IDs are UUIDv7 generated by the Prisma client and stored as `uuid`; the first migration creates the shared-kernel tables `idempotency_keys` and `outbox_events`.

---

## 26. Database Review Checklist Before Migrations

- [ ] Confirm every required entity has an owner module.
- [ ] Confirm every state transition has a persisted history path.
- [ ] Confirm inventory reservation/release cannot oversell under concurrency.
- [ ] Confirm wallet ledger + reservation cannot double-spend credit.
- [ ] Confirm partial returns/refunds are representable.
- [ ] Confirm supplier purchase discrepancies are representable without rewriting invoices.
- [ ] Confirm historical snapshots are sufficient for old orders.
- [ ] Confirm hard deletes are blocked for historical business entities.
- [ ] Confirm audit records are append-only.
- [ ] Confirm marketing consent is not inferred from account existence.
- [ ] Confirm notification delivery retries cannot create duplicate business actions.
- [ ] Confirm required indexes are supported by expected access patterns.
- [ ] Confirm retention/backup/security requirements are compatible with storage choices.

## 27. Next Stage

After this document is approved:

**Database Design → API Contract v1.1 → Implementation Task Breakdown**

No production migration should be generated before the Database Design and API Contract are reviewed together.


## v1.1 Closure Decisions and Audit Corrections

The canonical text of closure decisions C1–C6 and of the Pre-Implementation Audit Corrections 1–10 lives only in `docs/product/business-spec.md`. The copies that used to be repeated here were removed in TASK-002A to prevent the documents drifting apart.

## v1.1 Database Amendments

### `approval_requests`
Persistent workflow for pending approvals.

Fields:
- `id`
- `approval_type`
- `entity_type`
- `entity_id`
- `requested_by_employee_id`
- `status` = `PENDING` | `APPROVED` | `REJECTED` | `CANCELLED`
- `requested_at`
- `resolved_by_employee_id` nullable
- `resolved_at` nullable
- `reason` nullable
- `metadata_json` nullable

### `purchase_invoices`
Immutable supplier invoice metadata.

Fields:
- `id`
- `purchase_order_id`
- `invoice_number`
- `invoice_date`
- `invoice_total`
- `tax_amount` nullable
- `media_asset_id`
- `created_at`

The invoice record is never rewritten to disguise receiving discrepancies.

### `supplier_ledger_entries`
Supplier payable / credit history.

Fields:
- `id`
- `supplier_id`
- `purchase_order_id` nullable
- `supplier_return_id` nullable
- `entry_type` = `INVOICE` | `PAYMENT` | `CREDIT` | `REFUND` | `ADJUSTMENT`
- `amount`
- `direction`
- `reference`
- `created_at`
- `created_by_employee_id`

### `supplier_payments`
Optional normalized payment detail linked to supplier ledger entries.

### `order_revisions`
Material order edits are recorded separately from the immutable commercial snapshot.

Fields:
- `id`
- `order_id`
- `revision_number`
- `requested_by_customer_id`
- `reason`
- `old_total`
- `new_total`
- `status` = `PENDING_CONFIRMATION` | `CONFIRMED` | `REJECTED` | `EXPIRED`
- `snapshot_json`
- `created_at`
- `confirmed_at`

### `marketing_consents`
Explicit consent history.

Fields:
- `id`
- `customer_id`
- `channel` = `EMAIL` | `WHATSAPP`
- `purpose` = `MARKETING`
- `status` = `OPTED_IN` | `OPTED_OUT`
- `source`
- `occurred_at`

### Wishlist reminder state
`wishlist_items` should include or link to reminder state (cadence, maximum and stop conditions: Business Spec R6):
- `last_reminded_at`
- `reminder_count`
- `reminders_stopped_reason` nullable

### Variant canonicalization
Every sellable SKU must have a `product_variant_id`. A simple product gets a single `Default Variant`. Inventory balances, prices, costs, and SKUs are variant-level.

### Review granularity
Reviews are displayed at Product level and reference the qualifying `order_item_id`; the order item identifies the purchased variant.

### Tax-inclusive order snapshots
Orders/order items should store:
- `tax_included` boolean
- `tax_amount` nullable
- `tax_rate` nullable
No tax engine is required in v1.

### Return financials
Store separately:
- original outbound shipping fee
- return pickup fee
- fee responsibility
- eligible product refund
- deduction
- final wallet refund

### Wallet full-coverage order
If wallet reservation equals the final order total, the order has `cod_amount = 0`; no COD confirmation is required.

## v1.2 TASK-002A Amendments

Added by TASK-002A (`docs/tasks/TASK-002A-docs-closure.md`). Technical entities required by ADR-0008, the API contract and the business rules but missing from v1.1. Business decisions still open are marked `[BUSINESS DECISION REQUIRED]`.

### Authentication (ADR-0008, Business Spec R13, R15)

#### `auth_sessions`
- `id`
- `account_id`
- `domain` = `CUSTOMER` | `EMPLOYEE` (a session never crosses domains)
- `token_hash` unique (SHA-256 of the opaque token; the token itself is never stored)
- `refresh_token_hash` nullable, unique (rotation details: TASK-007/TASK-011)
- `created_at`, `last_used_at`, `expires_at`
- `revoked_at` nullable, `revoke_reason` nullable (`LOGOUT` | `LOGOUT_ALL` | `PASSWORD_RESET` | `DEACTIVATED` | `ROTATED` | `REUSE_DETECTED`)
- `ip_address`, `user_agent` (coarse metadata)

Customer lifetime 30 days (Q162). Staff default lifetime 12 hours maximum with a 60-minute idle timeout, Owner/Admin-configurable; a staff password reset revokes all sessions (Business Spec R29).

**Superseded by "v1.2 TASK-007 Amendments":** the token columns moved to `auth_session_tokens`; customer password-reset behaviour is R23; staff lifetime and reset are R29.

#### `otp_challenges`
- `id`
- `account_id` nullable (null before registration completes)
- `purpose` = `EMAIL_VERIFICATION` | `PASSWORD_RESET` | `EMPLOYEE_LOGIN` | `EMAIL_CHANGE` | `PHONE_CHANGE` | `GUEST_ORDER_CLAIM`
- `channel` = `EMAIL` | `WHATSAPP`
- `destination` (normalized email or phone)
- `code_hash`
- `attempt_count`, `max_attempts` (5, Q158)
- `expires_at` (5 minutes, Q159), `last_sent_at` (60 s resend cooldown, Q160)
- `consumed_at` nullable, `locked_until` nullable
- `ip_address`, `device_id` nullable (Q161)
- `created_at`

Channel for `PHONE_CHANGE` and `GUEST_ORDER_CLAIM`: **email** (Business Spec R30, R31; replaces the WhatsApp channel of R25). `PHONE_CHANGE` goes to the account's verified email; `GUEST_ORDER_CLAIM` goes to the `guest_email` of the guest order(s). SMS and WhatsApp remain future channels. Purpose `PHONE_VERIFICATION` added in TASK-007 (see "v1.2 TASK-007 Amendments").

#### `employee_invitations` (Q64)
- `id`, `email`, `employee_level`, `role_ids_json`
- `invited_by_employee_id`
- `token_hash` unique, `expires_at`, `accepted_at` nullable, `revoked_at` nullable
- `created_at`

#### Account lifecycle (Q154)
- `accounts.deactivated_at` nullable
- `customers.anonymized_at` nullable — personal fields are replaced by placeholders; order snapshots required for legal/audit history are retained.

### Reliability

#### `idempotency_keys` (Architecture §10, API §9)
- `id`
- `scope` (actor type + actor id, or guest cart token)
- `operation` (e.g. `WALLET_ADJUSTMENT`, `RETURN_COMPLETE`, `MANUAL_REFUND`, `WEBHOOK:<provider>`)
- `key`
- `request_fingerprint`
- `status` = `IN_PROGRESS` | `COMPLETED` | `FAILED`
- `response_status`, `response_body_json` nullable
- `resource_type`, `resource_id` nullable
- `created_at`, `expires_at`

Unique: `scope + operation + key`. Same key with a different fingerprint → `IDEMPOTENCY_CONFLICT`. Checkout keeps `checkout_attempts` (§7), which follows the same pattern.

#### `outbox_events`
Written in the **same transaction** as the business change, then delivered by a worker, so "external side effects after commit" cannot be lost if the process stops between commit and enqueue.
- `id`
- `event_type` (API §31 events, e.g. `ORDER_CREATED`)
- `aggregate_type`, `aggregate_id`
- `payload_json`
- `status` = `PENDING` | `PROCESSING` | `DONE` | `FAILED`
- `attempt_count`, `available_at`, `last_error` nullable
- `created_at`, `processed_at` nullable

Queue technology remains deferred (Architecture §27); the outbox works with any of them.

### Orders & COD

#### `cod_confirmation_tokens` (R10, R16)
- `id`
- `order_id`
- `order_revision_id` nullable (re-confirmation of a material revision, C5)
- `token_hash` unique
- `channel` = `WHATSAPP`
- `expires_at` (never later than the COD confirmation deadline, at most 72 hours after order creation — Q25, Business Spec R21)
- `used_at` nullable
- `created_at`

The link only confirms; it never exposes order tracking or cancellation (R16).

#### Order financial fields (completes §8 and the v1.1 amendments)
`orders` additionally stores:
- `cod_amount` (0 when the wallet covers the whole total, C4)
- `wallet_amount_captured` (0 until captured)
- `tax_included`, `tax_amount`, `tax_rate` nullable (C1; no rate or amount until tax invoicing starts, Business Spec R38.5)
- `applied_discount_id` nullable + `discount_snapshot_json` (code, percentage, cap at order time)
- `shipping_company_id` nullable + `shipping_rule_snapshot_json`
- `locale` (`ar` | `en`) used for customer messages

`order_number`: generated from a PostgreSQL sequence and formatted as a readable string (exact format fixed in TASK-030). It never authorizes access (API §4).

### Shipping follow-up

#### `customer_contact_tasks` (Q19, Q129)
- `id`
- `order_id`, `shipment_id`
- `reason` = `DELIVERY_FAILED_THRESHOLD` | `OTHER`
- `status` = `OPEN` | `IN_PROGRESS` | `RESOLVED` | `CANCELLED`
- `assigned_employee_id` nullable
- `outcome_notes` nullable
- `created_at`, `resolved_at` nullable, `resolved_by_employee_id` nullable

The failure threshold that creates a task is a setting.

### Notifications for guests and staff (DB-6)
- `notifications` has `recipient_type` = `CUSTOMER` | `EMPLOYEE` (§17). Staff notifications (e.g. low stock, Q110) use `EMPLOYEE`.
- `notification_deliveries.notification_id` becomes nullable and gains `order_id` nullable, `template_key`, `locale`, so transactional WhatsApp/email messages to **guests** (order received, COD confirmation request) are logged without an in-app notification.

### Marketing consent
`marketing_consents` (v1.1 amendment) is the only consent store; `customer_marketing_preferences` is removed (§3.4). Consent captured from guests at checkout (Q155, User Flows §16.2): not collected: guests are not offered marketing opt-in (Business Spec R38.4).

### Bilingual content (Business Spec R14)
Customer-facing text is stored as `_ar` / `_en` column pairs (two fixed languages; no translation tables in v1): products, product variants, brands, categories, product media alt text. Order snapshots store the names in both languages. `customers.preferred_locale` and `orders.locale` choose the language of messages.

### Removed / replaced in v1.2
| v1.1 element | v1.2 |
|---|---|
| `customer_marketing_preferences` | `marketing_consents` |
| `products.sku`, `selling_price`, `latest_purchase_cost`, `weighted_average_cost`, `low_stock_threshold` | variant level (C6) |
| `products.main_media_id` | `product_media.is_main` |
| `discounts.active` | `discounts.status` |

## v1.2 TASK-007 Amendments

Added by TASK-007 (`docs/tasks/TASK-007-customer-auth-core.md`, ADR-0013, Business Spec R23–R27). Migrated in `prisma/migrations/*_customer_auth_core`.

### `accounts` (§3.1)
- `status` adds `PENDING_VERIFICATION` (default at registration). A customer account becomes `ACTIVE` once the email is verified (Business Spec R30 amends R25; activation is TASK-008).
- `password_changed_at` (set at registration and on every password change/reset).
- A pending account expires **24 hours** after `created_at` (R25). It is treated as non-existent afterwards.
- Unique `(account_type, email) WHERE email_verified_at IS NOT NULL` (`accounts_verified_email_key`), plus a plain index on `(account_type, email)` for lookups.
- Replacement (R25): a new registration deletes pending accounts with the same email or phone whose email and phone are both unverified, and any expired pending account, together with their sessions. This is the only hard delete in the identity model and is allowed because a pending account cannot hold any business history (ADR-0013 §7).

### `customers` (§3.2)
- `phone`: E.164 Egyptian mobile (R27).
- `phone_verified_at` nullable.
- Unique `phone WHERE phone_verified_at IS NOT NULL` (`customers_verified_phone_key`), plus a plain index on `phone`. Several pending accounts may hold the same unverified phone; the first to verify it keeps it.
- `preferred_locale` defaults to `ar`. `date_of_birth`, `status` and `anonymized_at` are deferred to TASK-009.

### `auth_sessions` (replaces the v1.2 TASK-002A definition)
One login on one device (a refresh-token family).
- `id`, `account_id`, `domain` = `CUSTOMER` | `EMPLOYEE`
- `created_at`, `last_used_at` (written at most once a minute), `expires_at` (absolute: customers 30 days after login — Q162, R23)
- `revoked_at` nullable, `revoke_reason` nullable = `LOGOUT` | `LOGOUT_ALL` | `PASSWORD_CHANGE` | `PASSWORD_RESET` | `DEACTIVATED` | `REUSE_DETECTED`
- `ip_address`, `user_agent` (coarse metadata; user agent truncated to 512 characters)
- Index `(account_id, revoked_at)`.

### `auth_session_tokens`
One issued access/refresh pair. Only SHA-256 hashes are stored.
- `id`, `session_id` (cascade delete with the session)
- `access_token_hash` unique, `refresh_token_hash` unique
- `access_expires_at` (15 minutes, never after the session expiry)
- `created_at`, `rotated_at` nullable (set when the refresh token is used; a superseded refresh token presented again revokes the session — ADR-0013)

### `rate_limit_buckets`
Throttling counters shared by all app instances (ADR-0013 §4).
- `key` primary key (e.g. `login:account:<sha256(email)>`, `login:ip:<ip>`, `register:ip:<ip>`)
- `count`, `window_started_at`, `blocked_until` nullable, `updated_at` (indexed, for cleanup)

### `otp_challenges` (migrated in TASK-008; see "v1.2 TASK-008 Amendments")
- `purpose` adds `PHONE_VERIFICATION` (registration, R25). Not used in v1: R30 removed the registration phone OTP.
- `channel`: `EMAIL` for every purpose in v1 (Business Spec R30, R31), including `EMPLOYEE_LOGIN` (R28). `WHATSAPP` stays in the enum for later.

#### `employee_trusted_devices` (Business Spec R28)
- `id`
- `account_id` (employee account)
- `device_token_hash` unique (SHA-256 of an opaque device token held by the client; the token itself is never stored)
- `verified_at` (time of the successful `EMPLOYEE_LOGIN` OTP)
- `expires_at` = `verified_at` + 30 days
- `revoked_at` nullable
- `ip_address`, `user_agent` (coarse metadata)
- `created_at`

An employee login on a device with an unexpired, unrevoked row skips the `EMPLOYEE_LOGIN` OTP; otherwise the OTP is required and a new row is written on success. Applies to every employee level, Owner/Admin included.
- Limits (Q158–Q161) reuse `rate_limit_buckets`.

## v1.2 TASK-008 Amendments

Added by TASK-008 (`docs/tasks/TASK-008-email-otp-recovery.md`, ADR-0014). Migrated in `prisma/migrations/*_otp_challenges`.

### `otp_challenges` (final v1 shape; replaces the §3 field list)
One row per code sent.
- `id`, `account_id` nullable (cascade delete with the account; null reserved for codes sent before an account exists, e.g. guest claims)
- `purpose` = `EMAIL_VERIFICATION` | `PASSWORD_RESET` | `EMPLOYEE_LOGIN` | `EMAIL_CHANGE` | `PHONE_CHANGE` | `PHONE_VERIFICATION` | `GUEST_ORDER_CLAIM`
- `channel` = `EMAIL` | `WHATSAPP` (`EMAIL` for every purpose in v1, R30/R31)
- `destination` (normalized email)
- `code_hash` (SHA-256 of `<id>:<code>`)
- `attempt_count`, `max_attempts` (5, Q158)
- `expires_at` (5 minutes, Q159), `last_sent_at`
- `consumed_at` nullable, `superseded_at` nullable (set when a newer code is sent for the same purpose and destination)
- `grant_token_hash` unique nullable, `grant_expires_at` nullable, `grant_used_at` nullable: the single-use password-reset token issued by a verified `PASSWORD_RESET` code (10 minutes)
- `ip_address` nullable, `created_at`
- Indexes `(purpose, destination, created_at)` and `(account_id)`.

Removed from the earlier design: `locked_until` (a code is dead after 5 attempts; waits come from the send limits in `rate_limit_buckets`) and `device_id` (Q161 limits use email and IP; employee devices are `employee_trusted_devices`, TASK-011).

Rate-limit keys added: `otp:send:<purpose>:<sha256(email)>`, `otp:send-hour:<purpose>:<sha256(email)>`, `otp:send:ip:<ip>`, `otp:verify:ip:<ip>`.

## v1.2 TASK-011 Amendments

Added by TASK-011 (`docs/tasks/TASK-011-employee-auth.md`, ADR-0015, Business Spec R28, R29). Migrated in `prisma/migrations/*_employee_auth`.

### `employees` (§4, migrated)
- Fields as in §4: `id`, `account_id` (unique; an `EMPLOYEE` account), `display_name`, `employee_level` = `OWNER` | `ADMIN` | `MANAGER` | `EMPLOYEE`, `department` nullable, `status` = `ACTIVE` | `DEACTIVATED`, `created_by_employee_id` nullable (null for the first Owner), `deactivated_at` nullable, `created_at`, `updated_at`.
- An employee can sign in only when both `accounts.status` and `employees.status` are `ACTIVE`. Rows are never hard-deleted (Q69).
- `roles`, `permissions`, `employee_roles`, `role_permissions` and `employee_invitations` are migrated by TASK-012 (see "v1.2 TASK-012 Amendments").

### `employee_trusted_devices` (migrated as designed in "v1.2 TASK-007 Amendments")
- `expires_at` is fixed at `verified_at` + 30 days (R28); use does not extend it. Index on `account_id`.
- Logout, logout-all and password reset leave devices trusted; revocation (`revoked_at`) is used by employee management (TASK-012).

### `auth_sessions` for employees
- `domain = EMPLOYEE`. `expires_at` = login + the configured maximum (default 12 hours, R29). The session is also rejected when `last_used_at` is older than the configured idle timeout (default 60 minutes); a token refresh does not update `last_used_at` (ADR-0015).

### `otp_challenges`
- `grant_token_hash` / `grant_expires_at` / `grant_used_at` also hold the **employee login ticket** for `EMPLOYEE_LOGIN` codes: issued with the code after the password check, valid 15 minutes, single use (ADR-0015).
- A new code supersedes only open codes of the **same account**, purpose and destination, so a customer and an employee sharing an email (R15) keep separate codes.

### Rate-limit keys added
`employee-login:account:<sha256(email)>`, `employee-login:ip:<ip>` (R24 values), and employee code send limits `otp:send:EMPLOYEE:<purpose>:<sha256(email)>`, `otp:send-hour:EMPLOYEE:<purpose>:<sha256(email)>`.

## v1.2 TASK-012 Amendments

Added by TASK-012 (`docs/tasks/TASK-012-roles-permissions.md`, ADR-0016). Migrated in `prisma/migrations/*_roles_permissions`.

### `roles` (§4, migrated)
- `id`, `name` (unique; also unique ignoring case, checked by the service), `description` nullable, `is_system_role` (default false), `created_by_employee_id` nullable, `created_at`, `updated_at`. Never deleted.

### `permissions` (§4, migrated)
- `id`, `code` unique, `description`. The migration inserts every code of `docs/security/permission-catalog.md`; later catalog changes need a migration.

### `role_permissions`, `employee_roles` (§4, migrated)
- `role_permissions`: primary key `role_id + permission_id`; index on `permission_id`.
- `employee_roles`: primary key `employee_id + role_id`, `assigned_by_employee_id` nullable, `assigned_at`; index on `role_id`.

### `employee_invitations` (v1.2 TASK-002A Amendments, migrated)
- As designed (`email`, `employee_level`, `role_ids_json`, `invited_by_employee_id`, `token_hash` unique, `expires_at`, `accepted_at`, `revoked_at`, `created_at`), plus `display_name`, `department` nullable (chosen by the inviter), `accepted_employee_id` unique nullable (the employee created by accepting) and `revoked_by_employee_id` nullable. Index on `email`.
- Status is derived: accepted, revoked, expired (`expires_at` passed) or pending. At most one pending invitation per email (checked under a per-email lock). `token_hash` is the SHA-256 of the emailed token.

### `employees`
- Index on `(status, employee_level)` for the employee list. Deactivation sets `status = DEACTIVATED` and `deactivated_at`, revokes `auth_sessions` (`revoke_reason = DEACTIVATED`) and sets `employee_trusted_devices.revoked_at`; no row is deleted (Q69).

## v1.2 TASK-004 Amendments

Added by TASK-004 (`docs/tasks/TASK-004-seed-bootstrap.md`, ADR-0017). Migrated in `prisma/migrations/*_settings`.

### `settings` (§20, migrated)
- `key` (primary key), `value_json`, `data_type` = `INTEGER` | `BOOLEAN` | `STRING` | `JSON`, `updated_by_employee_id` nullable (null for values written by the bootstrap), `updated_at`.
- First keys (R29): `staff_session.max_lifetime_minutes` = 720, `staff_session.idle_timeout_minutes` = 60. The bootstrap inserts missing keys and never overwrites a value; readers use the default when a row is missing or invalid.
- `setting_history` (§20) is not migrated yet: it comes with the settings endpoints (TASK-057), when values can first change.

### Bootstrap data
- The first Owner: an `EMPLOYEE` account (`ACTIVE`, email verified) and an `OWNER` employee with `created_by_employee_id` null, created by `npm run db:seed` only while no Owner exists.
- The default roles of the permission catalog §3, with fixed ids `00000000-0000-7000-8000-00000000000N`, `is_system_role = false`, `created_by_employee_id` null; created once, never changed by later runs.

## TASK-001 Reconciliation

The canonical rule text lives in `docs/product/business-spec.md` (R1–R12). Schema implications:

| Rule | Schema implication |
|---|---|
| R1, R10 — COD confirmation | `order_status_history.changed_by_type = SYSTEM` for `PENDING_CONFIRMATION → NEW`; `orders.cod_confirmation_source`, `cod_confirmed_at`, `cod_confirmation_recorded_by_employee_id` (§8). |
| R2, R3 — Order/Shipment separation, shipping cancellation request | `orders.status` has no shipment-level values; `shipments.status` includes `RETURNED`; cancellation requests are `shipment_events` (§8, §9). |
| R5, R9 — Money and rounding | Principle 3. `discounts.value` (percentage) and `tax_rate` are not money columns. |
| R6 — Wishlist reminders | `wishlist_items.last_reminded_at`, `reminder_count`, `reminders_stopped_reason` (Wishlist reminder state amendment). |
| R7 — Customer-caused refund | `return_items.deduction_amount`, `refund_eligible_amount`, resolution + `audit_logs` (§12). |
| R11 — Cancellation window | Allowed `→ CANCELLED` source statuses are enforced by the backend state machine, recorded in `order_status_history`. |
| R12 — Restock subscriptions | `restock_subscriptions.product_variant_id` (§15). |

## v1.2 TASK-013 Amendments

Added by TASK-013 (`docs/tasks/TASK-013-approvals-audit.md`, ADR-0018). Migrated in `prisma/migrations/*_audit_logs_approvals`.

### `audit_logs` (§20, migrated)
- Fields as designed: `id`, `actor_type` = `SYSTEM` | `EMPLOYEE` | `CUSTOMER`, `actor_id` nullable (employee or customer id; null for `SYSTEM`; no foreign key because it points at either table), `action`, `entity_type`, `entity_id`, `previous_data_json` nullable, `new_data_json` nullable, `reason` nullable, `correlation_id` nullable (the API request id), `created_at`.
- `entity_id` is text, so entities keyed by something other than a UUID (a setting key) can be audited.
- Append-only: the trigger `audit_logs_append_only` rejects every `UPDATE` and `DELETE`, from the application or any SQL client.
- Indexes: `(entity_type, entity_id, created_at desc)` (§22), `(created_at desc)`, `(actor_type, actor_id, created_at desc)`.
- An entry is written in the same transaction as the change it describes. Snapshots never contain passwords, password hashes, codes or tokens.

### `approval_requests` (v1.1 Database Amendments, migrated)
- Fields as designed, plus `resolution_reason` nullable (why it was approved, rejected or cancelled; required to reject). `reason` is the requester's reason.
- `approval_type` is an enum: `PURCHASE_ORDER`, `PURCHASE_OVER_DELIVERY`, `MARKETING_CAMPAIGN`, `CRITICAL_SETTING` (Business Spec R19). `entity_id` is text, like `audit_logs.entity_id`.
- `requested_by_employee_id` and `resolved_by_employee_id` reference `employees`.
- At most one `PENDING` request per `(approval_type, entity_type, entity_id)` (partial unique index `approval_requests_one_pending_key`). Indexes on `(status, requested_at)` and `(entity_type, entity_id)`.
- Rows are never deleted; a request ends `APPROVED`, `REJECTED` or `CANCELLED`.

## v1.2 TASK-014 Amendments

Added by TASK-014 (`docs/tasks/TASK-014-products-variants.md`, ADR-0019). Migrated in `prisma/migrations/*_products_variants`.

### `products` (§5, migrated)
- Fields: `id`, `name_ar`, `name_en`, `slug` (unique; lowercase Latin letters, digits and single hyphens, enforced by a check constraint), `description_ar` nullable, `description_en` nullable, `status` = `DRAFT` | `PUBLISHED` | `ARCHIVED` | `DISABLED` (default `DRAFT`), `created_at`, `updated_at`, `archived_at` nullable.
- `brand_id` is added by TASK-015 with the `brands` table (see "v1.2 TASK-015 Amendments").
- Index `(status, created_at desc)`.

### `product_variants` (§5, migrated)
- Fields: `id`, `product_id` (references `products`, delete restricted), `sku` (unique, stored uppercase, enforced by a check constraint), `is_default`, `variant_name_ar` nullable, `variant_name_en` nullable, `attributes_json` nullable (object of text values), `status` = `ACTIVE` | `ARCHIVED`, `created_at`, `updated_at`, `archived_at` nullable.
- At most one default per product (partial unique index `product_variants_one_default_key`); the default must be `ACTIVE` (check constraint). The service creates every product with its default variant, so each product has exactly one.
- `selling_price`, `latest_purchase_cost`, `weighted_average_cost` are added by TASK-018 and `low_stock_threshold` by the inventory tasks, with their rules.
- Index `(product_id, created_at)`.

### No hard delete
- The trigger function `catalog_reject_delete` rejects `DELETE` on `products` and `product_variants` (Q75). Variants are archived; products are archived by TASK-017.

### Uniqueness note
- §22 lists "product SKU"; per §5 v1.2 SKUs exist only on variants, so only `product_variants.sku` is unique.

## v1.2 TASK-015 Amendments

Added by TASK-015 (`docs/tasks/TASK-015-brands-categories.md`, ADR-0020). Migrated in `prisma/migrations/*_brands_categories`.

### `brands` (§5, migrated)
- Fields: `id`, `name_ar`, `name_en`, `slug` (unique; same format check as products), `description_ar` nullable, `description_en` nullable, `status` = `ACTIVE` | `INACTIVE` (enum `taxonomy_status`, default `ACTIVE`), `created_at`, `updated_at`.
- Index `(status, name_en)`.

### `categories` (§5, migrated)
- Fields: `id`, `name_ar`, `name_en`, `slug` (same format check), `parent_id` nullable (references `categories`, delete restricted; a check constraint forbids a category being its own parent), `status` (`taxonomy_status`), `created_at`, `updated_at`.
- Slug unique within parent scope (§22): partial unique indexes `categories_top_level_slug_key` on `slug` where `parent_id IS NULL`, and `categories_parent_slug_key` on `(parent_id, slug)` where `parent_id IS NOT NULL`. Index on `parent_id`.
- At most 3 levels and no loops: enforced by the service, which changes the tree one write at a time.

### `product_categories` (§5, migrated)
- Fields: `product_id`, `category_id` (both reference their tables, delete restricted), `created_at`. Primary key `(product_id, category_id)`; index on `category_id`.
- Rows are removed when a category is taken off a product; the product's audit entries keep the history.

### `products.brand_id` (§5, migrated)
- Nullable, references `brands` (delete restricted). Index on `brand_id`.

### No hard delete
- The trigger function `catalog_reject_delete` now also rejects `DELETE` on `brands` and `categories` (Q75); they are deactivated instead.

## v1.2 TASK-016 Amendments

Added by TASK-016 (`docs/tasks/TASK-016-product-media.md`, ADR-0021). Migrated in `prisma/migrations/*_product_media`.

### `media_assets` (§6, migrated)
- Fields of §6: `id`, `storage_provider` (`LOCAL` until a provider is chosen), `object_key` (unique, generated by the server), `original_filename`, `mime_type`, `size_bytes` (positive), `width`, `height`, `checksum` (SHA-256 hex), `scan_status` = `PENDING` | `SAFE` | `REJECTED` (enum `media_scan_status`), `created_by_employee_id` nullable, `created_at`.
- Added for the upload flow (API §28): `purpose` (enum `media_purpose`: `PRODUCT_MEDIA`; return evidence and supplier invoices add values later), `rejection_reason` nullable, `upload_token_hash` nullable unique (cleared once completed), `upload_expires_at`, `uploaded_at` nullable, `completed_at` nullable.
- A `SAFE` row has `width`, `height`, `checksum` and `completed_at` (check constraint). Index `(created_by_employee_id, created_at)`.

### `product_media` (§5, migrated)
- Fields of §5: `id`, `product_id`, `variant_id` nullable, `media_asset_id` (all reference their tables, delete restricted), `sort_order` (not negative), `is_main`, `alt_text_ar`, `alt_text_en`, `created_at`. Added: `updated_at`, `removed_at` nullable.
- At most one current main image per product (partial unique index `product_media_one_main_key` on `product_id` where `is_main AND removed_at IS NULL`); a removed image is never main (check constraint). A file is on a product at most once at a time (`product_media_asset_once_key`). Indexes `(product_id, sort_order)`, `media_asset_id`, `variant_id`.
- The variant belongs to the same product: enforced by the service.
- Draft without a main image (the §5 `[BUSINESS DECISION REQUIRED]`): decided in ADR-0021 §5 item 6, confirmed by the product owner on 2026-10-01: a draft may have none; publishing requires one (TASK-017).

### No hard delete
- The trigger function `catalog_reject_delete` now also rejects `DELETE` on `media_assets` and `product_media`. Removing an image sets `removed_at`; the file is kept for order history (Q184) and audit.

### Settings
- New key `catalog.max_images_per_product` (INTEGER, default 20; Q177), inserted by the bootstrap.

## v1.2 TASK-017 Amendments

Added by TASK-017 (`docs/tasks/TASK-017-product-publishing.md`, ADR-0022). Migrated in `prisma/migrations/*_product_lifecycle`.

### `products` (§5, migrated)
- New column `first_published_at` nullable: set by the first publish, never cleared; locks the slug.
- Check constraint `products_archived_at_check`: `archived_at` is set exactly when `status = 'ARCHIVED'`.
- Check constraint `products_first_published_check`: a `PUBLISHED` product has `first_published_at`.
- Trigger `products_archive_final`: once `ARCHIVED`, the status never changes again (archiving is final in v1, ADR-0022 §4 item 1).
- Status changes are recorded in `audit_logs` (`PRODUCT_PUBLISHED`, `PRODUCT_UNPUBLISHED`, `PRODUCT_DISABLED`, `PRODUCT_ARCHIVED`); there is no separate status history table.
- Archiving a product leaves its variants' status unchanged; the product status alone decides whether they are purchasable.

## v1.2 TASK-018 Amendments

Added by TASK-018 (`docs/tasks/TASK-018-pricing-cost.md`, ADR-0023). Migrated in `prisma/migrations/*_variant_pricing`.

### `product_variants` (§5, migrated)
- New columns, integer piastres (principle 3): `selling_price` nullable (tax-inclusive, C1), `latest_purchase_cost` nullable, `weighted_average_cost` nullable, `currency` (`CHAR(3)`, default `EGP`).
- New column `first_goods_receipt_at` nullable: set by the first goods receipt (TASK-023); from then on costs are not typed by hand (ADR-0023 §4 item 4).
- Check constraints: `product_variants_selling_price_check` (price null or positive), `product_variants_costs_check` (costs null or not negative), `product_variants_currency_check` (`EGP` only).
- Trigger `product_variants_price_kept`: a selling price, once set, is never cleared.
- A `PUBLISHED` product's active variants all have a selling price: enforced by the service under the product lock (publish check, new variants need a price).
- Price and cost changes are recorded in `audit_logs` (`PRODUCT_VARIANT_PRICE_CHANGED`, `PRODUCT_VARIANT_COST_CHANGED`; §12 "price changes"); there is no separate price history table.
- `low_stock_threshold` is added by TASK-019 (see "v1.2 TASK-019 Amendments").

### Settings
- New key `pricing.min_margin_basis_points` (INTEGER 0–9999, default 1000 = 10%; Q102, Q111), inserted by the bootstrap. Selling-price reviews warn below it.

## v1.2 TASK-019 Amendments

Added by TASK-019 (`docs/tasks/TASK-019-inventory-ledger.md`, ADR-0024). Migrated in `prisma/migrations/*_inventory_ledger`.

### `products` and `product_variants` (§5, migrated)
- New column `low_stock_threshold` (INTEGER, nullable, ≥ 0) on both. A variant's own threshold wins; otherwise its product's applies; none means no alert (ADR-0024 §4 item 2).

### `inventory_balances` (§10, migrated)
- `product_variant_id` is the primary key (one row per variant, FK restrict). `available_quantity`, `reserved_quantity`, `damaged_quantity` INTEGER default 0; check `inventory_balances_quantities_check` keeps all three ≥ 0. `updated_at` is the time of the last movement.
- Trigger `inventory_balances_create` inserts the row when a variant is inserted; the migration created rows for existing variants.
- Trigger `inventory_balances_guard`: rows are updated only by the movement trigger below and never deleted.

### `inventory_movements` (§10, migrated)
- `quantity_delta` is replaced by `available_delta`, `reserved_delta`, `damaged_delta` (INTEGER default 0; check `inventory_movements_delta_check`: at least one non-zero), so a move between quantities is one row and each balance is the sum of its movements.
- `movement_type` enum `inventory_movement_type`: `MANUAL_ADJUSTMENT`, `DAMAGE`, `DAMAGE_WRITE_OFF` for now; `PURCHASE_RECEIPT`, `CUSTOMER_ORDER_COMMIT`, `RELEASE_RESERVATION`, `CUSTOMER_RETURN_RESTOCK`, `SUPPLIER_RETURN` and the reservation movement are added by their tasks.
- `reference_type` / `reference_id` (UUID) nullable; `unit_cost` BIGINT piastres nullable (check ≥ 0); `reason` nullable (required by the service for manual adjustments, Q72); `created_by_type` uses `audit_actor_type`; `created_by_id` nullable.
- Trigger `inventory_movements_apply` adds the deltas to the balance in the same statement; trigger `inventory_movements_append_only` rejects UPDATE and DELETE.
- Index `(product_variant_id, created_at DESC)` (§17).
- Manual adjustments are also recorded in `audit_logs` (`INVENTORY_ADJUSTED`; §12 "stock adjustments").

## v1.2 TASK-020 Amendments

Added by TASK-020 (`docs/tasks/TASK-020-inventory-reservations.md`, ADR-0025). Migrated in `prisma/migrations/*_inventory_reservations`.

### `inventory_reservations` (§10, migrated)
- Fields of §10 plus `converted_at` nullable. `status` enum `inventory_reservation_status` (`ACTIVE`, `RELEASED`, `CONVERTED`). `quantity` > 0.
- `order_id` is a UUID without a foreign key until `orders` exists (TASK-030 adds it).
- Check `inventory_reservations_status_check`: `released_at` is set exactly for `RELEASED`, `converted_at` exactly for `CONVERTED`.
- Partial unique index `inventory_reservations_one_active_key` on `(order_id, product_variant_id) WHERE status = 'ACTIVE'`: one active hold per order and variant. Indexes `(product_variant_id, status)` (§17) and `(order_id)`.
- Trigger `inventory_reservations_guard`: no deletes; the only change is `ACTIVE` → `RELEASED` or `ACTIVE` → `CONVERTED`, once, with order, variant, quantity and `reserved_at` unchanged.

### `inventory_movements` (§10)
- New `movement_type` values: `RESERVATION` (Available → Reserved), `RELEASE_RESERVATION` (Reserved → Available), `CUSTOMER_ORDER_COMMIT` (Reserved out, at `SHIPPED`). They carry `reference_type = 'ORDER'` and `reference_id` = the order id.

## v1.2 TASK-021 Amendments

Added by TASK-021 (`docs/tasks/TASK-021-suppliers.md`, ADR-0026). Migrated in `prisma/migrations/*_suppliers`.

### `suppliers` (§11, migrated)
- Fields of §11 plus `created_at`, `updated_at`. `phone`, `email`, `address`, `notes` nullable; `email` stored lowercase.
- `status` enum `supplier_status` (`ACTIVE`, `INACTIVE`); `INACTIVE` suppliers get no new purchase orders (TASK-022).
- Index `(status, name)`. Names are unique ignoring case (service check).
- Trigger `suppliers_no_delete`: rows are deactivated, never deleted.

## v1.2 TASK-022 Amendments

Added by TASK-022 (`docs/tasks/TASK-022-purchase-orders.md`, ADR-0027). Migrated in `prisma/migrations/*_purchase_orders`.

### `purchase_orders` (§11, migrated)
- Fields of §11 plus `currency` (`EGP`), `submitted_at`, `sent_at`, `cancelled_by_employee_id`, `cancelled_at`, `cancellation_reason`. `ordered_total` is piastres (`bigint`, ≥ 0), the sum of the line totals.
- `invoice_media_id` is not created: supplier invoices are `purchase_invoices` rows (v1.1 amendments, TASK-023).
- `purchase_number`: `PO-` + six digits from the sequence `purchase_order_number_seq`, unique.
- `status` enum `purchase_order_status` as in §11. TASK-022 uses `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `SENT`, `CANCELLED`; goods receiving (TASK-023) sets the others.
- `supplier_id`, `created_by_employee_id`, `approved_by_employee_id`, `cancelled_by_employee_id`: foreign keys, `RESTRICT`.
- Indexes `(status, created_at)`, `(supplier_id, created_at)`.
- Trigger `purchase_orders_no_delete`: orders are cancelled, never deleted.

### `purchase_items` (§11, migrated)
- Fields of §11. `unit_cost`, `line_total` in piastres; check `ordered_quantity > 0`, `unit_cost > 0`, `line_total = ordered_quantity × unit_cost`.
- Unique `(purchase_order_id, product_variant_id)`; foreign keys `RESTRICT`.
- Trigger `purchase_items_draft_only`: lines are inserted, changed or deleted only while their order is `DRAFT`.

## v1.2 TASK-023 Amendments

Added by TASK-023 (`docs/tasks/TASK-023-goods-receiving.md`, ADR-0028). Migrated in `prisma/migrations/*_goods_receipts`.

### `purchase_orders` (§11, migrated)
- Added `closed_by_employee_id` (foreign key, `RESTRICT`), `closed_at`, `closing_reason`: set together exactly when `status = 'CLOSED'` (check `purchase_orders_closed_check`).
- Goods receiving sets `PARTIALLY_RECEIVED` / `RECEIVED`; closing sets `CLOSED`.

### `goods_receipts` (§11, migrated)
- Fields of §11 without `status` and `reviewed_by_employee_id`: receiving is one step (ADR-0028 §3 item 1), so a receipt is final when recorded.
- `receipt_number`: `GR-` + six digits from the sequence `goods_receipt_number_seq`, unique. Index `(purchase_order_id, received_at)`.

### `goods_receipt_items` (§11, migrated)
- Fields of §11. Check: all quantities ≥ 0, `delivered_quantity > 0`, `delivered_quantity = accepted_quantity + damaged_quantity + over_delivery_quantity`.
- Accepted units went to Available, damaged ones to Damaged; over-delivered units enter Available only when their `PURCHASE_OVER_DELIVERY` approval request (entity `GOODS_RECEIPT`, the receipt id) is approved. The request records the decision; the row is never changed.
- Unique `(goods_receipt_id, purchase_item_id)`; index `purchase_item_id`.

### `purchase_invoices` (v1.1, migrated)
- Fields of v1.1 plus `notes`, `recorded_by_employee_id`. `invoice_date` is a date; `invoice_total` (> 0) and `tax_amount` (0 to the total, nullable) are piastres as on the invoice.
- `media_asset_id` unique: a file of purpose `SUPPLIER_INVOICE`. Unique `(purchase_order_id, invoice_number)`.

### Append-only
- Trigger function `purchasing_reject_change` rejects `UPDATE` and `DELETE` on `goods_receipts`, `goods_receipt_items` and `purchase_invoices` (Q115, Q117).

### Enums
- `inventory_movement_type` gains `PURCHASE_RECEIPT` (reference type `GOODS_RECEIPT`, with `unit_cost`).
- `media_purpose` gains `SUPPLIER_INVOICE`.

## v1.2 TASK-024 Amendments

Added by TASK-024 (`docs/tasks/TASK-024-supplier-returns-ledger.md`, ADR-0029). Migrated in `prisma/migrations/*_supplier_returns_ledger`.

### `supplier_returns` (§11, migrated)
- Fields of §11 plus `return_number` (`SR-` + six digits from the sequence `supplier_return_number_seq`, unique), `expected_amount` (piastres, > 0: Σ quantity × unit cost, Q120), `settlement_notes`, `created_by_employee_id`, `submitted_at`, `approved_at`, `settled_by_employee_id`, `settled_at`, `created_at`, `updated_at`. `purchase_order_id` is required (returns come from a purchase order's receipts).
- `status` enum `supplier_return_status`: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SETTLED`. `SHIPPED` and `RECEIVED_BY_SUPPLIER` of §11 are not created: approval sends the units back (owner decision, ADR-0029 §3). `REJECTED` is final.
- `financial_resolution` enum `supplier_return_resolution` (`REFUND`, `CREDIT`, `OTHER`); `financial_amount` piastres ≥ 0, 0 exactly for `OTHER`.
- Checks: `approved_at`/`approved_by_employee_id` set exactly for `APPROVED`/`SETTLED`; settlement fields set exactly for `SETTLED`.
- Indexes `(purchase_order_id, created_at)`, `(supplier_id, created_at)`, `(status, created_at)`. Trigger `supplier_returns_no_delete`.

### `supplier_return_items` (§11, migrated)
- Fields of §11 plus `goods_receipt_item_id` (required): each line returns damaged units of one goods receipt line (Q106). `purchase_item_id` is required. `quantity` > 0, `unit_cost` > 0 (the purchase line's cost).
- Unique `(supplier_return_id, goods_receipt_item_id)`; index `goods_receipt_item_id`. Append-only.
- A line's quantity, plus the lines of other `PENDING_APPROVAL`/`APPROVED`/`SETTLED` returns, never exceeds the receipt line's `damaged_quantity` (service check under the purchase order lock).

### `supplier_payments` (v1.1, migrated)
- `id`, `supplier_id`, `purchase_order_id` nullable, `amount` (piastres, > 0), `method` enum `supplier_payment_method` (`CASH`, `BANK_TRANSFER`, `CHEQUE`, `OTHER`), `paid_on` date, `reference`, `notes`, `recorded_by_employee_id`, `created_at`. Index `(supplier_id, created_at)`. Append-only.

### `supplier_ledger_entries` (v1.1, migrated)
- Fields of v1.1 plus `purchase_invoice_id` (unique) and `supplier_payment_id` (unique). `entry_type` enum `supplier_ledger_entry_type`; `direction` enum `supplier_ledger_direction`: `CREDIT` raises what we owe the supplier, `DEBIT` lowers it. `amount` piastres > 0. The balance is Σ `CREDIT` − Σ `DEBIT`.
- Check `supplier_ledger_entries_check`: `INVOICE` is `CREDIT` with its invoice, `PAYMENT` is `DEBIT` with its payment, `CREDIT` is `DEBIT` and `REFUND` is `CREDIT`, both with their return. `ADJUSTMENT` is not created in v1.
- Unique `(supplier_return_id, entry_type)`. Indexes `(supplier_id, created_at)`, `purchase_order_id`. Append-only.
- The migration adds an `INVOICE` entry for every invoice already recorded.

### Append-only
- `purchasing_reject_change` also guards `supplier_ledger_entries`, `supplier_payments`, `supplier_return_items` (update and delete) and `supplier_returns` (delete).

### Enums
- `inventory_movement_type` gains `SUPPLIER_RETURN` (Damaged out; reference type `SUPPLIER_RETURN`, with `unit_cost`).
- `approval_type` gains `SUPPLIER_RETURN` (entity type `SUPPLIER_RETURN`).

## v1.2 TASK-009 Amendments

Added by TASK-009 (`docs/tasks/TASK-009-profile-addresses.md`, ADR-0030). Migrated in `prisma/migrations/*_customer_profile_addresses` and `*_customer_deactivation`.

### `governorates` (new, R32)
- `id`, `code` (ISO 3166-2:EG without `EG-`, unique), `name_ar`, `name_en`, `status` enum `location_status` (`ACTIVE`, `INACTIVE`), `sort_order`, `created_at`, `updated_at`.
- The migration inserts the 27 Egyptian governorates (reference data). Trigger `governorates_no_delete`.

### `areas` (new, R32)
- `id`, `governorate_id` (FK, `RESTRICT`), `name_ar`, `name_en`, `status` (`location_status`), `created_at`, `updated_at`.
- Unique `(governorate_id, name_ar)` and `(governorate_id, name_en)`. Trigger `areas_no_delete`.
- TASK-027 points `shipping_rules` at `governorates`/`areas` instead of free text.

### `customer_addresses` (§3.3, migrated)
- Fields of §3.3, except that `governorate` and `area` are replaced by `area_id` (FK to `areas`, `RESTRICT`); the governorate is the area's. `label`, `city`, `building`, `floor`, `apartment`, `landmark`, `notes` nullable. `phone` is an Egyptian mobile in E.164.
- `customer_id` FK (`CASCADE`, only pending accounts are ever deleted and they have no addresses). Partial unique index `customer_addresses_one_default_key` on `(customer_id) WHERE is_default`. Indexes `(customer_id, created_at)`, `area_id`.
- Rows can be deleted: orders keep an address snapshot (Q46) and nothing references an address.

### `customers` (§3.2)
- Adds `date_of_birth` (date, nullable) and `anonymized_at` (nullable). `status` is not added (the account status covers it).
- Deactivation (Q154, R34): `full_name` becomes `Deleted customer`, `phone` empty, `phone_verified_at` and `date_of_birth` null, `anonymized_at` set; the account gets `status = DEACTIVATED`, `deactivated_at`, `email = deleted-<account id>@invalid` and `email_verified_at` null, so the partial unique indexes free the email and phone. Addresses and OTP challenges of the account are deleted; sessions are revoked (`DEACTIVATED`).

### `otp_challenges`
- Adds `pending_value` (nullable): the new phone of a `PHONE_CHANGE` code, which is sent to the account email (R30). `EMAIL_CHANGE` codes use `destination` (the new email).

## v1.2 TASK-025 Amendments

Added by TASK-025 (`docs/tasks/TASK-025-cart.md`, ADR-0031). Migrated in `prisma/migrations/*_cart`.

### `carts` (§7, migrated)
- `guest_token` is stored as `guest_token_hash` (SHA-256 of the token, unique): the token itself is never stored.
- `status` enum `cart_status` gains `MERGED` (a guest cart merged into a customer cart, R33). `currency` `CHAR(3)` default `EGP`.
- `customer_id` FK (`RESTRICT`). Check `carts_one_owner_check`: exactly one of `customer_id` / `guest_token_hash`. Partial unique index `carts_one_active_per_customer_key` on `(customer_id) WHERE status = 'ACTIVE'`.
- A guest cart adopted at merge keeps its id and gets `customer_id` (its token hash is cleared).
- R35: guest carts with `updated_at` older than `cart.guest_expiry_days` (setting, default 30) become `EXPIRED` (daily job); customer carts never expire; deactivation deletes the customer's `ACTIVE` cart.

### `settings`
- Adds the key `cart.guest_expiry_days` (integer, default 30, R35).

### `cart_items` (§7, migrated)
- `last_seen_unit_price` `BIGINT` piastres, `> 0`; `quantity > 0`. Unique `(cart_id, product_variant_id)`; index `product_variant_id`.
- `cart_id` FK `CASCADE`, `product_variant_id` FK `RESTRICT`.

## v1.2 TASK-026 Amendments

Added by TASK-026 (`docs/tasks/TASK-026-discounts.md`, ADR-0032). Migrated in `prisma/migrations/*_discounts`.

### `discounts` (§14, migrated)
- `name` is stored as `name_ar` / `name_en`. `discount_type` enum (`PERCENTAGE`); `value` integer 1–100 (whole percent, not money); `scope` enum `discount_scope` (`STORE_WIDE`, `TARGETED`).
- `code` nullable, uppercase (check), unique. `max_discount_amount`, `minimum_order_total` piastres `> 0` or null; `usage_limit_total`, `usage_limit_per_customer` `> 0` or null; `ends_at` nullable, after `starts_at`.
- `status` enum `discount_status` (`ACTIVE`, `INACTIVE`), default `INACTIVE`. `created_by_employee_id` FK. Trigger `discounts_no_delete`. Index `(status, starts_at)`.

### Targeting (migrated)
- `discount_products (discount_id, product_id)`, `discount_categories (discount_id, category_id)`, `discount_brands (discount_id, brand_id)`: composite primary keys, `CASCADE` from the discount, `RESTRICT` to the target. A category target covers its subcategories (R36).

### `discount_usages` (§14, migrated)
- Adds `released_at` nullable (the use was given back, R36). `order_id` unique (one use per order); its FK to `orders` is added by TASK-030. `customer_id` nullable FK (guests). `discount_amount` piastres `>= 0`. Indexes `(discount_id, released_at)`, `(customer_id, discount_id)`. Limits are enforced under a lock on the discount row.

### `carts`
- Adds `discount_id` nullable FK (`RESTRICT`): the shopper's chosen discount, rechecked on every read.

## v1.2 TASK-027 Amendments

Added by TASK-027 (`docs/tasks/TASK-027-shipping-rules.md`, ADR-0033). Migrated in `prisma/migrations/*_shipping_rules`.

### `shipping_companies` (§9, migrated)
- Fields of §9; `code` uppercase (check), unique; `contact_info` nullable free text. `status` enum `shipping_status` (`ACTIVE`, `INACTIVE`), default `ACTIVE`; `created_at`, `updated_at`. Trigger `shipping_companies_no_delete`.

### `shipping_rules` (§9, migrated)
- `governorate`/`area` are `governorate_id`/`area_id` (nullable FKs, `RESTRICT`, R32); an area rule also stores the area's governorate (check `area_id IS NULL OR governorate_id IS NOT NULL`, consistency kept by the service).
- `shipping_company_id` nullable FK (`RESTRICT`): the company proposed for the orders the rule prices; null leaves the choice to staff.
- `min_order_total` (inclusive) and `max_order_total` (exclusive) piastres, nullable, compared with the total after discounts; `shipping_fee` piastres `>= 0`; `priority` integer, default 0; `active_from`, `active_to` nullable (`active_to > active_from`); `status` (`shipping_status`, default `ACTIVE`). Index `status`. Trigger `shipping_rules_no_delete`.
- `free_shipping` is not stored: free shipping is one store-wide threshold (R37), setting `shipping.free_shipping_threshold` (integer piastres, default 250000 = 2500 EGP).

## v1.2 TASK-028 Amendments

Added by TASK-028 (`docs/tasks/TASK-028-wallet.md`, ADR-0034). Migrated in `prisma/migrations/*_wallet`.

### `wallets` (§13, migrated)
- Fields of §13; `customer_id` unique FK (`RESTRICT`); `currency` `CHAR(3)` default `EGP`; `balance` piastres, check `>= 0`, held credit included. Created empty on the first credit.
- `balance` is written only by the `wallet_transactions_apply` trigger; trigger `wallets_guard` rejects a non-zero insert, any other update and any delete.

### `wallet_transactions` (§13, migrated)
- Fields of §13. `transaction_type` enum `wallet_transaction_type` (`MANUAL_ADJUSTMENT`, `ORDER_WALLET_USE`, `RETURN_REFUND`; later tasks add theirs, e.g. a refund reversal); `direction` enum `wallet_direction` (`CREDIT`, `DEBIT`); `amount` piastres `> 0`; `reference_type`/`reference_id` (uuid) both set or both null; `reason` nullable.
- Append-only: trigger `wallet_transactions_append_only` rejects update and delete. Indexes `(wallet_id, created_at)`, `(reference_type, reference_id)`.

### `wallet_reservations` (§13, migrated)
- Fields of §13 plus `captured_at`. `status` enum `wallet_reservation_status` (`ACTIVE`, `CAPTURED`, `RELEASED`); check keeps `released_at`/`captured_at` consistent with the status. `amount` piastres `> 0`.
- At most one `ACTIVE` reservation per order (partial unique index `wallet_reservations_one_active_key`). `order_id` has no foreign key yet: TASK-030 adds it when `orders` exists.
- Available credit = `balance` − Σ `ACTIVE` reservations. Releasing writes no ledger entry; capturing writes the `ORDER_WALLET_USE` debit.

## v1.2 TASK-029 Amendments

Added by TASK-029 (`docs/tasks/TASK-029-checkout.md`, ADR-0035). Migrated in `prisma/migrations/*_orders_checkout`. Orders are migrated with checkout because the checkout transaction creates them (ADR-0035 §1); TASK-030 adds the `order_id` foreign keys of `inventory_reservations`, `discount_usages` and `wallet_reservations`.

### `orders` (§8 + "Order financial fields", migrated)
- Fields of §8 and the v1.2 order financial fields, except `billing_snapshot_json` (no billing data in a COD v1 order), `confirmed_at`, `delivered_at`, `cancelled_at`, `expired_at` and the COD confirmation fields, which TASK-030/TASK-031 add with their transitions.
- `status` enum `order_status`; `payment_method` enum `payment_method` (`COD`); `locale` (`ar`/`en`); money in piastres. `tax_included` default true, `tax_amount`/`tax_rate` null (C1).
- `order_number` unique, `BF-` + sequence `order_number_seq` (from 100001).
- Checks: a customer or a `guest_phone`; `subtotal > 0`; `0 <= discount_total <= subtotal`; `total = subtotal − discount_total + shipping_fee`; `0 <= wallet_amount_reserved <= total`; `0 <= wallet_amount_captured <= wallet_amount_reserved`; `cod_amount = total − wallet_amount_reserved`.
- `applied_discount_id` and `shipping_company_id` FK (`RESTRICT`); `discount_snapshot_json` (id, code, names, percentage, cap, minimum, amount), `shipping_rule_snapshot_json` (rule, company, place, rule fee, free shipping, threshold), `shipping_address_snapshot_json` (recipient, phone, governorate and area with both names, street fields, source address id), `customer_snapshot_json` (customer id, name, phone, email).
- Indexes `(customer_id, created_at)`, `(status, created_at)`, `guest_phone`.

### `order_items` (§8, migrated)
- Fields of §8. `product_name_snapshot` and `variant_name_snapshot` are JSON `{ ar, en }`; `image_snapshot` is the main image's media asset id. `unit_cost_at_sale` nullable (weighted average cost at sale). `discount_amount` is the line's share of the order discount (ADR-0035 §4).
- Unique `(order_id, product_variant_id)`; check `line_total = unit_price × quantity − discount_amount`, `quantity > 0`.

### `order_status_history` (§8, migrated)
- Fields of §8; `from_status` null for the first status; `changed_by_type` reuses `audit_actor_type`. Append-only (trigger `order_status_history_append_only`).

### `checkout_attempts` (§7, migrated)
- Fields of §7 plus `scope` (`CUSTOMER:<id>` or `GUEST_CART:<token hash>`); unique `(scope, idempotency_key)`; `result_order_id` unique; check: `SUCCEEDED` exactly when `result_order_id` is set. Only successful checkouts are stored (a failure rolls back).

## v1.2 TASK-030 Amendments

Added by TASK-030 (`docs/tasks/TASK-030-order-core.md`, ADR-0036). Migrated in `prisma/migrations/*_order_core`.

- `orders.confirmed_at` (§8), set by `New → Confirmed`. `delivered_at`, `cancelled_at`, `expired_at` and the COD confirmation fields are still added by their tasks (TASK-031, TASK-033, TASK-034).
- Foreign keys to `orders(id)` (`RESTRICT`): `inventory_reservations.order_id`, `discount_usages.order_id`, `wallet_reservations.order_id`.
- §24 enforced: trigger `orders_immutable` rejects `DELETE` and any change of `order_number`, `guest_email`, `guest_phone`, `payment_method`, `currency`, `locale`, the money columns except `wallet_amount_captured`, the tax columns, `applied_discount_id`, the four snapshot JSON columns and `created_at`; `customer_id` may only change from null (guest order claim). Trigger `order_items_immutable` rejects every `UPDATE` and `DELETE` of `order_items`. Lifecycle columns (`status`, timestamps, `wallet_amount_captured`, `shipping_company_id`) stay writable.

## v1.2 TASK-031 Amendments

Added by TASK-031 (`docs/tasks/TASK-031-cod-confirmation.md`, ADR-0037). Migrated in `prisma/migrations/*_cod_confirmation`.

- `orders` (§8, R10, R39): `cod_confirmation_deadline_at` (set at checkout for `PENDING_CONFIRMATION` orders: creation + the timeout setting, at most 72 hours; never recomputed), `cod_confirmation_source` (enum `cod_confirmation_source` = `WHATSAPP` | `PHONE`), `cod_confirmed_at`, `cod_confirmation_recorded_by_employee_id` (FK `employees`, `RESTRICT`; check: required when the source is `PHONE`), `cod_reminder_count` (default 0, never negative), `cod_last_reminder_at`, `expired_at`. Index `(status, cod_confirmation_deadline_at)` for the reminder and expiry jobs. All are lifecycle columns, writable under `orders_immutable`. Orders already pending at migration time got the 72-hour deadline.
- `cod_confirmation_tokens` as in "Orders & COD", without `order_revision_id` (added with revisions, TASK-032). `channel` uses the same enum (default `WHATSAPP`). Index on `order_id`.
- Settings (§20): `cod.confirmation_timeout_hours` (1–72, default 72), `cod.reminder_interval_hours` (default 24), `cod.reminder_max_count` (default 2, 0 allowed), `cod.confirmation_channel` (`WHATSAPP` | `PHONE`, default `WHATSAPP`).

## v1.2 TASK-032 Amendments

Added by TASK-032 (`docs/tasks/TASK-032-order-modification.md`, ADR-0038). Migrated in `prisma/migrations/*_order_revisions`.

- `order_revisions`: `id`, `order_id`, `revision_number` (unique per order), `requested_by_customer_id` (FK `customers`), `status` (enum `order_revision_status` = `PENDING_CONFIRMATION` | `CONFIRMED` | `SUPERSEDED` | `EXPIRED`; `SUPERSEDED` replaces the documented `REJECTED`), `old_total`, `new_total`, `request_json` (the resolved request), `previous_snapshot_json` (the order's lines and amounts before), `proposed_snapshot_json` (the priced new state), `expires_at` (24 hours, R40), `created_at`, `confirmed_at`. No `reason` column (not collected). Partial unique index: one `PENDING_CONFIRMATION` revision per order.
- `order_items` unique key becomes `(order_id, product_variant_id, unit_price)`: after a revision a variant may have a line at its order price and one at today's price (R40).
- `orders_immutable` / `order_items_immutable` amended: a confirmed revision may replace the order's items and its commercial columns (amounts, discount, shipping rule, address snapshot) only inside a transaction that sets the local flag `beautyfits.order_revision = on`. Order number, contact, payment method, currency, locale, `tax_included`, the customer snapshot and `created_at` never change; deleting orders and updating item rows are always refused.
- `cod_confirmation_tokens.order_revision_id` is not added: revisions are confirmed in the app (R40).

## v1.2 TASK-033 Amendments

Added by TASK-033 (`docs/tasks/TASK-033-cancellation-expiration.md`, ADR-0039). Migrated in `prisma/migrations/*_order_cancellation`.

- `orders.cancelled_at` (§8): set by `→ CANCELLED`; a lifecycle column, writable under `orders_immutable`. Who cancelled and why live in `order_status_history` (`changed_by_type`, `changed_by_id`, `reason`) and `audit_logs`; no separate columns.
- "Order expiration/cancellation" (§ transactions) is implemented by one shared step for both paths: change the status with history, then release the inventory reservations (`RELEASE_RESERVATION` movements), the discount use and the wallet reservation, in the same transaction.

## v1.2 TASK-034 Amendments

Added by TASK-034 (`docs/tasks/TASK-034-shipment-core.md`, ADR-0040). Migrated in `prisma/migrations/*_shipments`.

- `orders.delivered_at` (§8), set by `Shipped → Delivered` together with the shipment's (lifecycle column, writable under `orders_immutable`).
- `shipments` (§9): `id`, `order_id` (FK, `RESTRICT`), `shipping_company_id` (FK, `RESTRICT`, required), `tracking_number` nullable, `status` (enum `shipment_status`), `picked_up_at` (carrier handoff), `delivered_at`, `created_at`, `updated_at`. The row is created at handoff (`mark-shipped`); the documented `PENDING`/`READY` values are not stored (the order's `READY_FOR_SHIPMENT` is that stage, ADR-0040 §1). `status` = `SHIPPED` | `OUT_FOR_DELIVERY` | `DELIVERY_FAILED` | `RETURN_TO_SENDER` | `RETURNED` | `DELIVERED`. `attempt_count` (TASK-035) and `returned_at` (TASK-036) are added by their tasks. Unique `(shipping_company_id, tracking_number)` (§22); indexes `order_id`, `tracking_number`. Checks: `delivered_at` set exactly when `DELIVERED`; a tracking number is not blank. Trigger `shipments_no_delete`.
- `shipment_events` (§9): fields of §9; `event_type` enum `shipment_event_type` (`SHIPPED`, `TRACKING_UPDATED`, `OUT_FOR_DELIVERY`, `DELIVERED`; later tasks add theirs, e.g. `SHIPPING_CANCELLATION_REQUESTED`); `notes` nullable. Index `(shipment_id, event_at)`. Append-only (trigger `shipment_events_append_only`).

## v1.2 TASK-045 Amendments

Added by TASK-045 (`docs/tasks/TASK-045-notification-service.md`, ADR-0043). Migrated in `prisma/migrations/20261008045000_notifications`.

- `notifications` (§17, DB-6): enums `notification_recipient_type` (`CUSTOMER` | `EMPLOYEE`) and `notification_type` (`TRANSACTIONAL` | `MARKETING` | `RESTOCK`); FKs `customer_id` → `customers`, `employee_id` → `employees` (`RESTRICT`); check: exactly the recipient named by `recipient_type`. Added `source_event_id` (unique, nullable): the outbox event that produced it, so each event makes at most one notification. Indexes `(customer_id, read_at, created_at desc)` and `(employee_id, read_at, created_at desc)`. Rows are never deleted (Q58).
- `notification_deliveries` (§17, DB-6): `notification_id` nullable (FK `RESTRICT`), `order_id` nullable (FK `orders`, `RESTRICT`), `template_key`, `locale`, `channel` (enum `notification_channel` = `EMAIL` | `WHATSAPP`), `recipient`, `attempt_number` (≥ 1), `status` (enum `notification_delivery_status` = `PENDING` | `SENT` | `FAILED` | `FALLBACK_SENT`; `sent_at` required when sent), `provider_reference`, `failure_reason`, `created_at`, `sent_at` nullable. Added `source_event_id` with unique `(source_event_id, attempt_number)`: attempts are numbered per outbox event, and a sent event is never sent again. The message text is not stored (it may hold a COD link). Indexes `(status, created_at)`, `order_id`, `notification_id`.
- `outbox_events` is unchanged; the dispatcher uses `status`, `attempt_count`, `available_at` (lease and backoff) and `last_error` (ADR-0043 §1).
