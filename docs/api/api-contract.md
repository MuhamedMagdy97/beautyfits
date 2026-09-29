# BeautyFits — API Contract v1.1

**Status:** Proposed / Ready for Implementation Planning\
**Depends on:** Business Specification v1.1 + User Flows & State Machines v1.1 + System Architecture v1.1 + Database Design v1.1

## 1. Purpose

This document defines the backend API contract for BeautyFits. The API is the single business authority used by the Customer Website, Admin Dashboard, and future Mobile App. It defines endpoint responsibilities, request/response conventions, validation, authorization, idempotency, pagination, error handling, and integration boundaries. It is intentionally framework-neutral.

## 2. API Principles

1. The backend is authoritative for prices, stock, discounts, shipping, wallet, permissions, and order state.
2. Clients are untrusted; critical values are revalidated server-side.
3. Monetary values use integer minor units (for EGP, piastres) in machine-readable payloads. Derived amounts are computed with exact decimal/rational arithmetic and rounded HALF-UP to the nearest piastre by the backend; clients never recompute authoritative amounts (Business Spec R5, R9).
4. IDs are opaque.
5. Critical retryable operations support idempotency.
6. External provider calls occur outside core database transactions where possible.
7. Authorization is permission-based in the backend.
8. Historical data is returned from stored snapshots, not reconstructed from current data.
9. API versioning is explicit.

## 3. Base URL & Versioning

Recommended base path:

```text
/api/v1
```

Examples:

```text
GET /api/v1/products
POST /api/v1/checkout
GET /api/v1/orders/{orderId}
```

Breaking contract changes require a new major version.

## 4. Authentication Model

### Customer

Email OTP is used for verification/recovery. Phone is the primary customer identifier for business operations. Customers can log out from all devices.

### Guest

Guests can browse, manage a guest cart, and complete COD checkout. Guest order access must use a secure non-guessable mechanism; order number alone is never sufficient for authorization.

### Employee

Employees use a separate employee authorization domain with password + OTP/MFA. Owner/Admin accounts require mandatory MFA.

### Sensitive Changes

Changing email or phone requires re-authentication plus verification of the new destination. The old contact method should also receive a security notification where appropriate.

## 5. Common Headers

```text
Authorization: Bearer <access-token>
Content-Type: application/json
Accept: application/json
X-Request-Id: <request-id>
Idempotency-Key: <key>
```

`Idempotency-Key` is required for checkout/order creation and other retry-sensitive writes.

## 6. Standard Response Shapes

### Success

```json
{
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

### Collection

```json
{
  "data": [],
  "meta": {
    "requestId": "...",
    "pagination": {
      "page": 1,
      "pageSize": 24,
      "total": 240,
      "totalPages": 10
    }
  }
}
```

### Error

```json
{
  "error": {
    "code": "STOCK_CHANGED",
    "message": "One or more cart items are no longer available at the requested quantity.",
    "details": {},
    "requestId": "..."
  }
}
```

Clients should branch on stable error `code` values, not message text.

## 7. HTTP Semantics

- `GET` — read
- `POST` — create or execute an action
- `PATCH` — partial update
- `PUT` — full replacement only where explicitly defined
- `DELETE` — only for resources where deletion is safe; business history uses archive/deactivate semantics

## 8. Pagination, Filtering & Sorting

Standard collection parameters:

```text
page=1
pageSize=24
sort=createdAt:desc
search=lipstick
status=CONFIRMED
```

The backend enforces maximum page sizes and server-side filtering.

## 9. Concurrency & Idempotency

### Checkout

`POST /checkout` requires `Idempotency-Key`. A repeated request with the same valid key returns the already-created result instead of creating another order.

### Other retry-sensitive operations

At minimum:

- Refund creation
- Wallet adjustment
- Critical notification sends where duplicates are harmful
- Provider webhook processing

### Inventory concurrency

Stock validation and reservation occur inside a transaction with concurrency-safe locking or conditional updates.

# 10. Authentication Endpoints

## Customer

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/auth/register` | Create customer account | Public |
| POST | `/auth/verify-email-otp` | Verify email | Public |
| POST | `/auth/login` | Customer login | Public |
| POST | `/auth/refresh` | Refresh session | Authenticated |
| POST | `/auth/logout` | Logout current session | Authenticated |
| POST | `/auth/logout-all` | Revoke all customer sessions | Authenticated |
| POST | `/auth/forgot-password` | Start recovery | Public |
| POST | `/auth/verify-recovery-otp` | Verify recovery OTP | Public |
| POST | `/auth/reset-password` | Set new password | Recovery flow |
| POST | `/auth/resend-otp` | Resend OTP | Public/Recovery |

## Employee

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/employee-auth/login` | Employee login | Public |
| POST | `/employee-auth/verify-otp` | Complete employee MFA | Challenge |
| POST | `/employee-auth/refresh` | Refresh employee session | Employee |
| POST | `/employee-auth/logout` | Logout employee | Employee |

OTP rules are enforced server-side: expiration, retry count, resend cooldown, and abuse rate limits.

# 11. Customer Profile & Addresses

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/me` | Get current customer profile | Customer |
| PATCH | `/me` | Update editable profile fields | Customer |
| POST | `/me/change-email` | Change email with re-authentication + new-email OTP | Customer |
| POST | `/me/change-phone` | Change phone with re-authentication + new-phone OTP | Customer |
| GET | `/me/addresses` | List addresses | Customer |
| POST | `/me/addresses` | Create address | Customer |
| PATCH | `/me/addresses/{addressId}` | Update address | Customer |
| DELETE | `/me/addresses/{addressId}` | Remove address | Customer |
| POST | `/me/addresses/{addressId}/set-default` | Set default address | Customer |
| GET | `/me/notifications` | List notifications | Customer |
| POST | `/me/notifications/{notificationId}/read` | Mark one as read | Customer |
| POST | `/me/notifications/read-all` | Mark all as read | Customer |
| GET | `/me/preferences` | View allowed notification/marketing preferences | Customer |
| PATCH | `/me/preferences` | Update preferences | Customer |

Customer profile updates never rewrite historical order snapshots.

# 12. Guest Identity & Guest Order Linking

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/guest/orders/claim` | Start claim process | Authenticated customer |
| POST | `/guest/orders/claim/verify` | Verify OTP and link eligible guest orders | Authenticated customer |

A matching phone number alone is not sufficient proof of control.

# 13. Catalog

## Public

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/products` | Browse/search products | Public |
| GET | `/products/{productId}` | Product details | Public |
| GET | `/categories` | Categories | Public |
| GET | `/brands` | Brands | Public |

Public product responses expose current sellable information, not cost price or sensitive internal inventory quantities.

## Admin

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| POST | `/admin/products` | Create product | `PRODUCT_CREATE` |
| GET | `/admin/products` | List/search products | `PRODUCT_VIEW` |
| GET | `/admin/products/{productId}` | Product detail | `PRODUCT_VIEW` |
| PATCH | `/admin/products/{productId}` | Edit product | `PRODUCT_EDIT` |
| POST | `/admin/products/{productId}/archive` | Archive | `PRODUCT_ARCHIVE` |
| POST | `/admin/products/{productId}/publish` | Publish | `PRODUCT_PUBLISH` |
| POST | `/admin/products/{productId}/media` | Upload product media | `MANAGE_PRODUCT_MEDIA` |
| DELETE | `/admin/products/{productId}/media/{mediaId}` | Remove media | `MANAGE_PRODUCT_MEDIA` |
| POST | `/admin/products/{productId}/price-review` | Create/review price change | `EDIT_PRODUCT_PRICE` |

Cost fields are visible only to authorized staff.

# 14. Cart

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/cart` | Get current cart | Guest/Customer |
| POST | `/cart/items` | Add item | Guest/Customer |
| PATCH | `/cart/items/{cartItemId}` | Update quantity/variant | Guest/Customer |
| DELETE | `/cart/items/{cartItemId}` | Remove item | Guest/Customer |
| POST | `/cart/reprice` | Revalidate prices/stock/discounts | Guest/Customer |

Cart values are informational. Checkout revalidates all authoritative values.

# 15. Checkout & Orders

## Checkout

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/checkout/validate` | Validate cart, customer data, discount, shipping, totals | Guest/Customer |
| POST | `/checkout` | Create COD order and reserve required resources | Guest/Customer |

`POST /checkout` performs the authoritative calculation and transaction. The client cannot submit a trusted final total.

## Customer Orders

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/me/orders` | List own orders | Customer |
| GET | `/orders/{orderId}` | Get own order | Customer |
| POST | `/orders/{orderId}/modify` | Material order modification before `Preparing`; revalidates all commercial conditions; may return `RECONFIRMATION_REQUIRED` | Customer |
| POST | `/orders/{orderId}/cancel` | Cancel (before carrier pickup) or, after pickup, request shipping cancellation recorded on the Shipment | Customer |
| POST | `/orders/{orderId}/confirm-cod` | Confirm COD via WhatsApp secure link; System then moves `Pending Confirmation → New` | Customer/Guest secure link |

## Admin Orders

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/orders` | Search/filter orders | `ORDERS_VIEW` |
| GET | `/admin/orders/{orderId}` | Order detail | `ORDERS_VIEW` |
| POST | `/admin/orders/{orderId}/record-phone-confirmation` | Record a customer's COD confirmation received by phone (source `PHONE`, recording staff actor); System then moves `Pending Confirmation → New` | `RECORD_COD_CONFIRMATION` |
| POST | `/admin/orders/{orderId}/confirm` | New → Confirmed | `CONFIRM_ORDER` |
| POST | `/admin/orders/{orderId}/start-preparing` | Confirmed → Preparing | `START_PREPARING` |
| POST | `/admin/orders/{orderId}/mark-ready-for-shipment` | Preparing → Ready for Shipment | `MARK_READY_FOR_SHIPMENT` |
| POST | `/admin/orders/{orderId}/mark-shipped` | Ready for Shipment → Shipped (actual carrier handoff) | `MARK_AS_SHIPPED` |
| POST | `/admin/orders/{orderId}/mark-delivered` | Delivery confirmation | `MARK_AS_DELIVERED` |
| POST | `/admin/orders/{orderId}/cancel` | Administrative cancellation (same window as customer cancellation; reason required) | `CANCEL_ORDER` |
| POST | `/admin/orders/{orderId}/approve-status-change` | Approve pending status request | `APPROVE_ORDER_STATUS_CHANGE` |
| POST | `/admin/orders/{orderId}/request-shipping-cancellation` | Contact carrier to stop/return; recorded on the Shipment, Order stays `Shipped` | `REQUEST_SHIPPING_CANCELLATION` |

## Order Rules

**State machine (Business Spec R2, R4).** Arbitrary order-status jumps are rejected; every transition is validated against the state machine. Order `status` values are `PENDING_CONFIRMATION`, `NEW`, `CONFIRMED`, `PREPARING`, `READY_FOR_SHIPMENT`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `EXPIRED`. Delivery progress, delivery failures, return-to-sender and shipping cancellation requests are exposed through shipment data, never as order statuses. `mark-ready-for-shipment` must precede `mark-shipped`; `Preparing → Shipped` is rejected with `ORDER_STATE_INVALID`.

**COD confirmation (Business Spec R1, R10).** `Pending Confirmation → New` is performed only by the System; there is no staff transition endpoint for it. The confirmation event records its source:

| Confirmation path | Endpoint | `cod_confirmation_source` | Actor recorded |
|---|---|---|---|
| WhatsApp secure link (MVP) | `POST /orders/{orderId}/confirm-cod` | `WHATSAPP` | Customer/guest |
| Phone | `POST /admin/orders/{orderId}/record-phone-confirmation` (`RECORD_COD_CONFIRMATION`) | `PHONE` | Recording staff member (+ audit log) |
| SMS | Future | Future | — |

No `SECURE_LINK` confirmation source exists in the MVP; the secure link is part of the WhatsApp channel.

**Cancellation window (Business Spec R11).** Direct cancellation (customer `cancel`, or admin `cancel` with `CANCEL_ORDER` and a reason) is accepted only while the order is `PENDING_CONFIRMATION`, `NEW`, `CONFIRMED`, `PREPARING`, or `READY_FOR_SHIPMENT`. For a `SHIPPED` order, the customer `cancel` endpoint records a shipping cancellation request on the Shipment instead (order stays `SHIPPED`); staff use `request-shipping-cancellation`, and admin `cancel` is rejected with `ORDER_CANCELLATION_NOT_ALLOWED`. Any other status is rejected with `ORDER_CANCELLATION_NOT_ALLOWED`.

# 16. Shipping

| Method | Endpoint | Purpose | Permission/Auth |
|---|---|---|---|
| GET | `/shipping/options` | Quote available shipping options | Guest/Customer |
| GET | `/admin/shipping/companies` | List shipping companies | `SHIPPING_VIEW` |
| POST | `/admin/shipping/companies` | Create shipping company | `SHIPPING_MANAGE` |
| PATCH | `/admin/shipping/companies/{id}` | Edit shipping company | `SHIPPING_MANAGE` |
| GET | `/admin/shipping/rules` | List shipping rules | `SHIPPING_VIEW` |
| POST | `/admin/shipping/rules` | Create shipping rule | `SHIPPING_MANAGE` |
| PATCH | `/admin/shipping/rules/{id}` | Edit shipping rule | `SHIPPING_MANAGE` |
| POST | `/admin/orders/{orderId}/assign-shipping` | Assign contracted carrier | `ASSIGN_SHIPPING` |
| POST | `/admin/shipments/{shipmentId}/tracking` | Add/update tracking | `MANAGE_SHIPMENT` |

Rules can consider contracted company, governorate/area, and final order total.

## Shipping Webhook

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/webhooks/shipping/{provider}` | Receive provider events | Provider signature |

Webhook processing is idempotent, signature-verified, persisted, then mapped to allowed delivery-state changes.

# 17. Returns

## Customer

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/orders/{orderId}/returns` | Create return request | Customer |
| GET | `/me/returns` | List own returns | Customer |
| GET | `/returns/{returnId}` | Return detail | Customer |
| POST | `/returns/{returnId}/evidence` | Upload evidence | Customer |
| POST | `/returns/{returnId}/resubmit` | Submit a new request after rejection | Customer |

Return requests are limited to 14 days from actual delivery. Evidence is mandatory for configured damage/wrong-item cases.

## Admin

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/returns` | Search/filter returns | `RETURNS_VIEW` |
| GET | `/admin/returns/{returnId}` | Return detail | `RETURNS_VIEW` |
| POST | `/admin/returns/{returnId}/approve` | Approve | `APPROVE_RETURN` |
| POST | `/admin/returns/{returnId}/reject` | Reject | `APPROVE_RETURN` |
| POST | `/admin/returns/{returnId}/pickup` | Arrange carrier pickup | `MANAGE_RETURNS` |
| POST | `/admin/returns/{returnId}/receive` | Mark received | `RECEIVE_RETURN` |
| POST | `/admin/returns/{returnId}/start-inspection` | Start inspection | `INSPECT_RETURN` |
| POST | `/admin/return-items/{returnItemId}/inspection` | Inspect item | `INSPECT_RETURN` |
| POST | `/admin/returns/{returnId}/complete` | Complete + eligible refund | `COMPLETE_RETURN` |

Inspection is item-level and supports `RESTOCK`, `DAMAGED`, or `REJECTED`, plus notes/evidence. Customer-caused opened/used items may result in return-to-customer/no-refund or a configured partial wallet refund, and the decision must be auditable.

# 18. Wallet

| Method | Endpoint | Purpose | Auth/Permission |
|---|---|---|---|
| GET | `/me/wallet` | Wallet summary | Customer |
| GET | `/me/wallet/transactions` | Wallet ledger | Customer |
| GET | `/admin/customers/{customerId}/wallet` | View customer wallet | `VIEW_WALLET_BALANCE` |
| POST | `/admin/customers/{customerId}/wallet/adjust` | Manual adjustment | Owner/Admin / `ADJUST_WALLET` |
| POST | `/admin/returns/{returnId}/refund` | Wallet refund | Refund permission |
| POST | `/admin/returns/{returnId}/manual-refund` | Alternative future/manual refund | `MANAGE_MANUAL_REFUNDS` |

Wallet uses an append-only ledger plus reservations. Wallet credit used in a pending order is reserved so it cannot be spent twice.

# 19. Wishlist & Restock

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/me/wishlist` | View wishlist | Customer |
| POST | `/me/wishlist/items` | Add item | Customer |
| DELETE | `/me/wishlist/items/{itemId}` | Remove item | Customer |
| POST | `/me/wishlist/items/{itemId}/move-to-cart` | Move to cart | Customer |
| POST | `/variants/{variantId}/restock-subscription` | Subscribe to restock | Customer |
| DELETE | `/variants/{variantId}/restock-subscription` | Cancel subscription | Customer |

Wishlist is account-only. Out-of-stock items may remain visible. `Notify Me` is a separate explicit subscription.

# 20. Reviews

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/products/{productId}/reviews` | Published reviews | Public |
| POST | `/orders/{orderId}/items/{orderItemId}/review` | Verified-purchase review | Customer |
| PATCH | `/reviews/{reviewId}` | Edit own review | Customer |
| POST | `/reviews/{reviewId}/report` | Report review | Customer |

Reviews require a qualifying purchase. In v1 they publish immediately after automated abuse checks. Admin may hide them later without deleting moderation history.

# 21. Purchasing & Suppliers

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/suppliers` | Supplier list | `SUPPLIER_VIEW` |
| POST | `/admin/suppliers` | Create supplier | `SUPPLIER_MANAGE` |
| PATCH | `/admin/suppliers/{id}` | Edit supplier | `SUPPLIER_MANAGE` |
| GET | `/admin/purchases` | Purchase list | `PURCHASE_VIEW` |
| POST | `/admin/purchases` | Create purchase draft | `PURCHASE_CREATE` |
| POST | `/admin/purchases/{id}/submit` | Submit for approval | `PURCHASE_CREATE` |
| POST | `/admin/purchases/{id}/approve` | Approve purchase | Owner/Admin approval |
| POST | `/admin/purchases/{id}/receive` | Goods receipt | `RECEIVE_PURCHASE` |
| POST | `/admin/purchases/{id}/supplier-return` | Supplier return | `SUPPLIER_RETURN_MANAGE` |

Purchase invoices remain immutable. Quantity discrepancies are represented through receiving records.

# 22. Inventory

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/inventory` | Inventory overview | `INVENTORY_VIEW` |
| GET | `/admin/inventory/{variantId}` | Inventory details/history | `INVENTORY_VIEW` |
| POST | `/admin/inventory/{variantId}/adjust` | Manual stock adjustment | `ADJUST_INVENTORY` |
| POST | `/admin/inventory/{variantId}/receive` | Receive accepted stock | `RECEIVE_PURCHASE` |
| GET | `/admin/inventory/{variantId}/movements` | Movement history | `INVENTORY_VIEW` |

Manual adjustments require a reason and audit log. Available, reserved, and damaged quantities are not interchangeable.

# 23. Discounts

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/discounts` | Discount list | `DISCOUNT_VIEW` |
| POST | `/admin/discounts` | Create discount | `DISCOUNT_MANAGE` |
| PATCH | `/admin/discounts/{id}` | Edit discount | `DISCOUNT_MANAGE` |
| POST | `/admin/discounts/{id}/activate` | Activate | `DISCOUNT_MANAGE` |
| POST | `/admin/discounts/{id}/deactivate` | Deactivate | `DISCOUNT_MANAGE` |

MVP discount type is percentage. One discount is applied per order; if several are eligible, the customer selects one. Discount validity is rechecked at checkout. Maximum discount amount and usage limits are configurable.

# 24. Marketing & Campaigns

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/campaigns` | Campaign list | `MARKETING_VIEW` |
| POST | `/admin/campaigns` | Create campaign draft | `MARKETING_CREATE` |
| PATCH | `/admin/campaigns/{id}` | Edit draft | `MARKETING_EDIT` |
| POST | `/admin/campaigns/{id}/submit` | Submit for approval | `MARKETING_CREATE` |
| POST | `/admin/campaigns/{id}/approve` | Final approval | Owner/Admin |
| POST | `/admin/campaigns/{id}/send` | Send campaign | `MARKETING_SEND` + approval |
| GET | `/admin/campaigns/{id}/delivery` | Delivery/failure stats | `MARKETING_VIEW` |

Marketing recipients require explicit marketing consent. Frequency limits are enforced server-side. Transactional notifications remain separate from marketing consent.

# 25. Employees, Roles & Permissions

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/employees` | Employee list | Employee management |
| POST | `/admin/employees` | Invite/create employee | Authorized scope |
| PATCH | `/admin/employees/{id}` | Edit employee | Authorized scope |
| POST | `/admin/employees/{id}/deactivate` | Remove access without deleting history | Employee management |
| GET | `/admin/roles` | Role list | `ROLE_VIEW` |
| POST | `/admin/roles` | Create custom role | Owner/Admin |
| PATCH | `/admin/roles/{id}` | Edit role | Owner/Admin |
| GET | `/admin/permissions` | Permission catalog | Owner/Admin |
| GET | `/admin/approval-requests` | List approval requests | Owner/Admin |
| GET | `/admin/approval-requests/{id}` | Approval request detail | Owner/Admin |
| POST | `/admin/approval-requests/{id}/approve` | Approve pending action | Owner/Admin |
| POST | `/admin/approval-requests/{id}/reject` | Reject pending action | Owner/Admin |

Managers may create employees but cannot create Managers, modify the permission model, or escalate permissions beyond their allowed scope.

# 26. Audit Logs & Settings

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/audit-logs` | Search audit logs | Owner/Admin |
| GET | `/admin/settings` | Read settings | Owner/Admin |
| PATCH | `/admin/settings/{key}` | Change/propose setting | Owner/Admin |
| GET | `/admin/settings/history` | Setting history | Owner/Admin |

Critical settings changes require the defined approval workflow and always record old value, new value, actor, and timestamp.

# 27. Analytics

## Client event ingestion

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/analytics/events` | Submit analytics event | Public/Customer |

## Admin reporting

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/analytics/overview` | Dashboard KPIs | `ANALYTICS_VIEW` |
| GET | `/admin/analytics/funnel` | Views → Cart → Checkout → Orders | `ANALYTICS_VIEW` |
| GET | `/admin/analytics/products` | Product engagement/sales | `ANALYTICS_VIEW` |
| GET | `/admin/analytics/inventory` | Low stock/movement metrics | `ANALYTICS_VIEW` |
| GET | `/admin/analytics/profit` | Estimated gross profit | `ANALYTICS_VIEW_PROFIT` |

Analytics is never authoritative for orders, inventory, or wallet.

# 28. File Uploads

Recommended flow:

```text
POST /files/upload-init
        ↓
short-lived upload authorization
        ↓
object storage upload
        ↓
POST /files/complete
        ↓
backend validates/associates file
```

Validation includes file type, size, dimensions where relevant, and security/malware scanning before publication.

# 29. Stable Error Codes

```text
AUTH_INVALID_CREDENTIALS
AUTH_OTP_INVALID
AUTH_OTP_EXPIRED
AUTH_RATE_LIMITED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
IDEMPOTENCY_CONFLICT
STOCK_CHANGED
OUT_OF_STOCK
PRICE_CHANGED
DISCOUNT_INVALID
DISCOUNT_EXPIRED
SHIPPING_UNAVAILABLE
ORDER_STATE_INVALID
ORDER_CANCELLATION_NOT_ALLOWED
RECONFIRMATION_REQUIRED
RETURN_WINDOW_EXPIRED
RETURN_STATE_INVALID
WALLET_INSUFFICIENT_FUNDS
WALLET_RESERVATION_CONFLICT
PERMISSION_DENIED
APPROVAL_REQUIRED
DUPLICATE_OPERATION
PROVIDER_ERROR
INTERNAL_ERROR
```

# 30. API Security Rules

- Never expose password hashes, OTP secrets, internal tokens, cost data, or hidden audit fields to unauthorized clients.
- Validate every request server-side and authorize before mutation.
- Rate-limit authentication, OTP, checkout, review/report, and public analytics endpoints.
- Verify provider webhook signatures.
- Make webhook handlers idempotent.
- Use opaque identifiers where practical.
- Never trust client-supplied ownership identifiers.
- Validate uploads and scan them before publication.
- Log security failures without secrets.

# 31. Internal Events & Background Jobs

After successful transactional commits, internal events may trigger asynchronous work:

```text
ORDER_CREATED
ORDER_CONFIRMED
ORDER_SHIPPED
ORDER_DELIVERED
ORDER_EXPIRED
ORDER_CANCELLED
RETURN_APPROVED
RETURN_RECEIVED
RETURN_COMPLETED
WALLET_REFUNDED
PURCHASE_RECEIVED
RESTOCK_AVAILABLE
CAMPAIGN_APPROVED
```

Workers handle email, WhatsApp, in-app notifications, reminders, analytics enrichment, and shipping-provider integrations. Event handlers must be idempotent.

# 32. Critical API Rules

- Checkout revalidates current price, stock, discount, shipping, free-shipping eligibility, customer data, and total.
- Order status transitions follow the approved state machine; arbitrary jumps are rejected.
- Return eligibility is measured from actual delivery timestamp and closes after 14 days.
- Inventory reservations are atomic and released according to order cancellation/expiry rules.
- Wallet credit used in a pending order is reserved.
- One discount applies per order and the customer chooses among eligible discounts.
- Marketing endpoints require explicit consent.
- Historical orders are served from snapshots and are not rewritten by current profile/catalog changes.

# 33. Client Responsibilities

### Website / Mobile

- Treat API responses as authoritative.
- Handle `PRICE_CHANGED`, `STOCK_CHANGED`, and validation errors.
- Never assume a state transition is immediate.
- Refresh resource state after mutations where required.
- Support pagination and server-side filtering semantics.
- Avoid duplicating business rules that can drift from the backend.

### Admin Dashboard

- Show only actions permitted by returned authorization state.
- Represent approval/pending states clearly.
- Show required reasons and audit context.
- Never bypass API validation.

# 34. API Review Checklist

- [ ] Every business capability has an API path or is explicitly internal-only.
- [ ] Every mutation has an authorization rule.
- [ ] Checkout/refund/wallet operations/webhooks have idempotency.
- [ ] Inventory and wallet mutations cannot bypass their ledgers/reservation rules.
- [ ] Returns support per-item inspection and partial refund outcomes.
- [ ] Marketing requires explicit consent.
- [ ] Critical actions create audit entries.
- [ ] Historical snapshots are preserved.
- [ ] Stable error codes are used.
- [ ] Admin collections use server-side pagination/filtering.
- [ ] External side effects are decoupled from critical database transactions where practical.

# 35. Next Stage

**API Contract → Implementation Task Breakdown → Repository/Rules Setup → Backend Implementation Plan**

No production feature coding should begin until the relevant endpoint contract and acceptance criteria are frozen.


## v1.1 Closure Decisions (Post-Audit)

These decisions supersede earlier ambiguous or conflicting interpretations and are frozen for implementation planning.

### C1 — Tax / Order Receipt
- Customer-facing prices are treated as tax-inclusive for v1 where applicable.
- Store tax amount and tax metadata on the order/item financial snapshot so future tax-invoice support can be added without redesigning historical orders.
- No full tax engine or jurisdiction calculation module is required in v1 unless separately approved.

### C2 — Return Pickup Shipping
- Customer-caused returns / change-of-mind returns: customer pays the return pickup shipping directly to the carrier.
- BeautyFits / wrong-item / carrier-damage returns: BeautyFits bears the return pickup cost.
- Return shipping responsibility is based on final assessed responsibility, not the customer's initial description alone.

### C3 — Original Delivery Fee on Return
- Customer-fault / change-of-mind: product refund only; the original outbound delivery fee is not refunded.
- BeautyFits fault / wrong item / carrier damage: refund the eligible product amount plus the original outbound delivery fee.
- Future alternative refund methods remain permission-controlled.

### C4 — Wallet-Fully-Covers-Order
- If Wallet covers the entire final order total, COD amount is zero and no COD confirmation is required.
- Wallet funds are captured from their reservation when the order is finalized according to the order outcome.

### C5 — Order Modification
- Customer may modify an order only before `Preparing`.
- Any modification that changes quantity, price, discount, shipping fee, shipping address, wallet usage, or COD amount triggers full recalculation and a new customer confirmation step before the revised order is operationally confirmed.
- Non-financial, non-fulfillment notes may be editable without re-confirmation when permitted.
- Each material revision is auditable; the historical order is not silently rewritten.

### C6 — Product / Variant Canonical Model
- Every sellable SKU is represented by a `Product Variant`.
- Products without visible variants receive a single `Default Variant`.
- Price, cost, stock, SKU, and inventory live at variant level.
- Reviews are displayed at Product level, while the qualifying purchase references the purchased Variant via `Order Item`.

## v1.1 Pre-Implementation Audit Corrections

1. **Order vs Shipment state separation**
   - Order lifecycle: `Pending Confirmation → New → Confirmed → Preparing → Ready for Shipment → Shipped → Delivered`, plus `Cancelled` and `Expired`.
   - Shipment lifecycle: `Created/Ready → Picked Up/Shipped → Out for Delivery → Delivery Failed → Return to Sender → Returned`.
   - `Return` is a separate lifecycle from both Order and Shipment.

2. **Pending Confirmation → New is automatic**
   - Customer confirmation moves the order to `New` automatically.
   - Human staff then perform `New → Confirmed`.

3. **Ready for Shipment is a real transition**
   - `Preparing → Ready for Shipment` uses a dedicated permission before carrier handoff.
   - `Ready for Shipment → Shipped` confirms actual carrier pickup/handoff.

4. **Order modification requires re-confirmation when commercially material**
   - Material changes create a revision/revalidation flow rather than silently mutating the confirmed commercial state.

5. **Wallet reservation is not a refund**
   - A cancelled/expired pre-payment order releases reserved wallet funds.
   - Refunds create a wallet credit transaction only when funds were actually captured and became refundable.

6. **Supplier financial traceability**
   - Purchase invoices remain immutable.
   - Goods receipts represent quantity discrepancies.
   - Supplier payment/credit/refund activity is represented in a supplier ledger.

7. **Approval requests are first-class**
   - Manager/pending approvals are represented by a persistent `approval_requests` concept rather than only an API endpoint.

8. **Wishlist reminders are explicit background work**
   - Keep reminder count and last-sent state.
   - Respect marketing consent for marketing-style purchase reminders.
   - Restock `Notify Me` remains a separate explicit subscription.

9. **Marketing fallback respects consent**
   - Email fallback is permitted only when Email Marketing consent exists.
   - WhatsApp/Email delivery attempts remain independently logged.

10. **Security-sensitive account changes**
   - Email/phone changes require re-authentication plus verification of the new destination.
   - Owner/Admin accounts require MFA.

## v1.1 API Amendments

Order amendments (`modify`, `mark-ready-for-shipment`, `mark-shipped`) are merged into §15 and approval-request endpoints into §25; `RECONFIRMATION_REQUIRED` is listed in §29.

### Supplier finance

- `GET /admin/suppliers/{id}/ledger`
- `GET /admin/suppliers/{id}/balance`
- `POST /admin/purchases/{id}/invoice`
- `POST /admin/suppliers/{id}/payments`

### Marketing consent

- `GET /me/marketing-consents`
- `PATCH /me/marketing-consents`

Email fallback for marketing is only allowed when Email Marketing consent exists.

### Wishlist reminders

- `GET /me/wishlist/reminder-settings`
- `PATCH /me/wishlist/reminder-settings`

Wishlist purchase reminders must respect marketing consent. Restock `Notify Me` remains an explicit independent subscription.

### Financial response fields

Order/payment responses should expose:
- `subtotal`
- `discountTotal`
- `shippingFee`
- `taxAmount`
- `walletAmountReserved`
- `codAmount`
- `total`

If `walletAmountReserved == total`, `codAmount = 0` and no COD confirmation flow is required.

All of these fields are integer minor units (EGP piastres).

## TASK-001 Reconciliation

The canonical rule text lives in `docs/product/business-spec.md` (R1–R12). This contract applies them here:

| Rule | Where applied in this document |
|---|---|
| R1, R10 — COD confirmation / phone confirmation event | §15 Order Rules, Admin Orders table |
| R2, R3, R4 — Order vs Shipment status, shipping cancellation request, Ready for Shipment | §15 Order Rules, Admin Orders table |
| R5, R9 — Integer minor units, HALF-UP rounding | §2 Principle 3, Financial response fields |
| R6 — Wishlist reminders | Wishlist reminders amendment |
| R11 — Cancellation window | §15 Order Rules |
| R12 — Variant restock subscription | §19 |
