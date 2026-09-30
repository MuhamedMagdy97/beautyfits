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
10. All timestamps are stored in UTC; presentation timezone is handled by the application.

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
- `status` = `ACTIVE` | `SUSPENDED` | `DEACTIVATED`
- `last_login_at`
- `created_at`, `updated_at`

Constraints:
- normalized email is unique **per `account_type`** (the same email may hold one CUSTOMER and one EMPLOYEE account; Business Spec R15)
- password hashes only; never plaintext passwords
- customers log in with email + password (Business Spec R13); `deactivated_at` and `anonymized_at` support Q154 (v1.2 amendments)

### 3.2 `customers`

Key fields:
- `id`
- `account_id` nullable for guest-only historical customers if needed
- `phone` (normalized E.164, required, unique among active customer identities; primary business identifier, not the login — Business Spec R13)
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

Low-stock threshold level: `[BUSINESS DECISION REQUIRED]` — Q21 says per product, C6 puts stock at variant level. Until decided, the threshold is modelled on the variant with an optional product-level default.

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
- main image required for publishable product (Q178). Whether a Draft may exist without one: `[BUSINESS DECISION REQUIRED]` (User Flows §4.1 says "every product")
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

Exactly one of `customer_id` or `guest_token` identifies the cart owner.

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

Governorate/area representation (free text vs a managed location list shared by addresses and shipping rules): `[BUSINESS DECISION REQUIRED]`.

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

`[BUSINESS DECISION REQUIRED]`: the order point at which a reservation is consumed (`CONVERTED`, e.g. at `SHIPPED`) and whether reserving/releasing writes `inventory_movements` rows in addition to reservation rows (AGENTS.md requires a movement for every inventory change).

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

Rule: return eligibility is disabled after 14 days from the actual delivery timestamp.

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
- normalized account email
- customer phone
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

**Resolved in TASK-002:** ORM and migration tool are Prisma ORM 7 (`@prisma/adapter-pg`) and Prisma Migrate, with SQL migrations committed under `prisma/migrations/` and applied with `prisma migrate deploy` outside development. Schema conventions (minor-unit money, UUID ids, UTC timestamps, `snake_case` mapping) are recorded in `docs/decisions/ADR-0003-database-access-and-migrations.md`. No tables exist yet; TASK-003 creates the first migration. The ID generator (UUIDv4 vs v7) remains a TASK-003 decision.

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

Customer lifetime 30 days (Q162). Staff lifetime and password-reset behaviour: `[BUSINESS DECISION REQUIRED]` (TASK-002A open decisions 1–2).

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

Channel for `PHONE_CHANGE` and `GUEST_ORDER_CLAIM`: `[BUSINESS DECISION REQUIRED]` (SMS is a future channel, R10).

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
- `expires_at` (never later than the COD confirmation deadline, max 3 days — Q25)
- `used_at` nullable
- `created_at`

The link only confirms; it never exposes order tracking or cancellation (R16).

#### Order financial fields (completes §8 and the v1.1 amendments)
`orders` additionally stores:
- `cod_amount` (0 when the wallet covers the whole total, C4)
- `wallet_amount_captured` (0 until captured)
- `tax_included`, `tax_amount`, `tax_rate` nullable (C1; rate value: `[BUSINESS DECISION REQUIRED]`)
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
`marketing_consents` (v1.1 amendment) is the only consent store; `customer_marketing_preferences` is removed (§3.4). Consent captured from guests at checkout (Q155, User Flows §16.2): `[BUSINESS DECISION REQUIRED]` — if allowed, rows reference `guest_phone`/`guest_email` instead of `customer_id`.

### Bilingual content (Business Spec R14)
Customer-facing text is stored as `_ar` / `_en` column pairs (two fixed languages; no translation tables in v1): products, product variants, brands, categories, product media alt text. Order snapshots store the names in both languages. `customers.preferred_locale` and `orders.locale` choose the language of messages.

### Removed / replaced in v1.2
| v1.1 element | v1.2 |
|---|---|
| `customer_marketing_preferences` | `marketing_consents` |
| `products.sku`, `selling_price`, `latest_purchase_cost`, `weighted_average_cost`, `low_stock_threshold` | variant level (C6) |
| `products.main_media_id` | `product_media.is_main` |
| `discounts.active` | `discounts.status` |

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
