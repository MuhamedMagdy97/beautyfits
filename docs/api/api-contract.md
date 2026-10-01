# BeautyFits — API Contract v1.2

**Status:** Approved v1.2 — owner review completed in TASK-002A (2026-09-30). Items marked `[BUSINESS DECISION REQUIRED]` remain open and must be answered before their owning task. The review checklist below is verified by the tests of each implementing task.\
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

Customers log in with **email + password** (Business Spec R13). Email OTP is used for verification/recovery. Phone is required and remains the primary customer identifier for business operations (COD confirmation, guest-order linking). Customers can log out from all devices.

### Guest

Guests can browse, manage a guest cart, and complete COD checkout. Guests have **no online order tracking or cancellation** (Business Spec R16); they contact support or create an account and claim their orders (§12). The only guest-facing order action is the confirm-only COD link (§15), authorized by a secure non-guessable token; an order number alone never authorizes anything.

### Employee

Employees use a separate employee authorization domain with email + password + email OTP. After a successful OTP the device is trusted for 30 days; then, or on a new device, the OTP is required again. Owner/Admin follow the same rule in v1 (Business Spec R28). Default staff session: 12 hours maximum, 60 minutes idle, Owner/Admin-configurable (R29).

### Sensitive Changes

Changing email or phone requires re-authentication plus verification of the new destination. The old contact method should also receive a security notification where appropriate.

## 5. Common Headers

```text
Authorization: Bearer <access-token>
X-Auth-Transport: cookie
Content-Type: application/json
Accept: application/json
X-Request-Id: <request-id>
Idempotency-Key: <key>
Accept-Language: ar | en
X-Guest-Cart-Token: <token>
```

`Accept-Language` selects the language of localized public responses and messages (Business Spec R14; default `ar`). Admin endpoints return both languages (`nameAr`, `nameEn`, …). `X-Guest-Cart-Token` identifies a guest cart (§14). `X-Auth-Transport: cookie` makes login/refresh deliver the tokens as HttpOnly cookies instead of in the body (website; TASK-007 amendments).

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

### 6.1 Error conventions (TASK-002, ADR-0004/ADR-0005)

- Every API failure uses the error shape above, including unknown `/api/v1` paths (`NOT_FOUND`) and unexpected server failures (`INTERNAL_ERROR`, generic message; details are never leaked).
- `error.details` is always an object (`{}` when empty). For `VALIDATION_ERROR`, `details.issues` is a list of `{ path, code, message }`, where `path` is a dot-separated field path (e.g. `items.0.qty`).
- `X-Request-Id`: a well-formed client-supplied id (8–128 characters of `A–Z a–z 0–9 . _ : -`) is reused, otherwise the server generates one. It is returned in the `X-Request-Id` response header and in `meta.requestId` / `error.requestId`.
- API responses are sent with `Cache-Control: no-store`.
- Default HTTP status per error code (a feature task may refine a status only by updating this table):

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHENTICATED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_OTP_INVALID`, `AUTH_OTP_EXPIRED` |
| 403 | `FORBIDDEN`, `PERMISSION_DENIED`, `AUTH_EMAIL_NOT_VERIFIED` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `DUPLICATE_OPERATION`, `STOCK_CHANGED`, `PRICE_CHANGED`, `ORDER_STATE_INVALID`, `RETURN_STATE_INVALID`, `WALLET_RESERVATION_CONFLICT`, `RECONFIRMATION_REQUIRED` |
| 422 | `OUT_OF_STOCK`, `DISCOUNT_INVALID`, `DISCOUNT_EXPIRED`, `SHIPPING_UNAVAILABLE`, `ORDER_CANCELLATION_NOT_ALLOWED`, `RETURN_WINDOW_EXPIRED`, `WALLET_INSUFFICIENT_FUNDS`, `APPROVAL_REQUIRED` |
| 429 | `AUTH_RATE_LIMITED`, `RATE_LIMITED` |

Authentication/authorization semantics (TASK-002A):
- `UNAUTHENTICATED` (401): no token, or the token is invalid, expired or revoked. Clients sign in again (or refresh).
- `FORBIDDEN` (403): authenticated in the wrong domain (a customer token on an employee endpoint or the reverse), or an account that is deactivated.
- `FORBIDDEN` (403) also covers a customer account that is still `PENDING_VERIFICATION` on an endpoint that requires an `ACTIVE` account (`details.reason = "ACCOUNT_PENDING_VERIFICATION"`, Business Spec R26), and a cookie-authenticated request that fails the Origin/Referer check (TASK-007).
- `AUTH_EMAIL_NOT_VERIFIED` (403): correct credentials, but the email is not verified yet (Business Spec R26). Returned only after the password matched.
- `PERMISSION_DENIED` (403): an employee lacks the required permission from `docs/security/permission-catalog.md`.
- A resource the caller does not own (for example another customer's order) returns `NOT_FOUND`, so its existence is not revealed.
- `RATE_LIMITED` (429) is used by non-authentication endpoints (checkout, analytics, review/report); `AUTH_RATE_LIMITED` stays for login/OTP.
| 500 | `INTERNAL_ERROR` |
| 502 | `PROVIDER_ERROR` |

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
| POST | `/auth/login` | Customer login with email + password (R13) | Public |
| POST | `/auth/refresh` | Refresh session | Refresh token |
| POST | `/auth/logout` | Logout current session | Authenticated |
| POST | `/auth/logout-all` | Revoke all customer sessions | Authenticated |
| POST | `/auth/change-password` | Change password; keeps the current session, revokes the others (R23) | Authenticated |
| GET | `/auth/session` | Current account, customer and session expiry | Authenticated |
| POST | `/auth/forgot-password` | Start recovery | Public |
| POST | `/auth/verify-recovery-otp` | Verify recovery OTP | Public |
| POST | `/auth/reset-password` | Set new password | Recovery flow |
| POST | `/auth/resend-otp` | Resend OTP | Public/Recovery |

## Employee

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/employee-auth/login` | Employee login | Public |
| POST | `/employee-auth/verify-otp` | Complete the employee email OTP; trusts the device for 30 days (R28) | Challenge |
| POST | `/employee-auth/refresh` | Refresh employee session | Refresh token |
| POST | `/employee-auth/logout` | Logout employee | Employee |
| POST | `/employee-auth/logout-all` | Revoke all own employee sessions | Employee |
| POST | `/employee-auth/resend-otp` | Resend login OTP | Challenge |
| POST | `/employee-auth/forgot-password` | Start employee password recovery | Public |
| POST | `/employee-auth/reset-password` | Set new password after recovery OTP | Recovery flow |
| POST | `/employee-auth/accept-invitation` | Accept an invitation and set a password (Q64) | Invitation token |

OTP rules are enforced server-side: expiration, retry count, resend cooldown, and abuse rate limits.

# 11. Customer Profile & Addresses

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/me` | Get current customer profile | Customer |
| PATCH | `/me` | Update editable profile fields | Customer |
| POST | `/me/change-email` | Change email with re-authentication + new-email OTP | Customer |
| POST | `/me/change-phone` | Change phone with re-authentication + OTP to the verified account email (Business Spec R30) | Customer |
| POST | `/me/deactivate` | Deactivate/anonymize own account, keeping required order/audit records (Q154) | Customer (re-authentication) |
| GET | `/me/addresses` | List addresses | Customer |
| POST | `/me/addresses` | Create address | Customer |
| PATCH | `/me/addresses/{addressId}` | Update address | Customer |
| DELETE | `/me/addresses/{addressId}` | Remove address | Customer |
| POST | `/me/addresses/{addressId}/set-default` | Set default address | Customer |
| GET | `/me/notifications` | List notifications | Customer |
| POST | `/me/notifications/{notificationId}/read` | Mark one as read | Customer |
| POST | `/me/notifications/read-all` | Mark all as read | Customer |
| GET | `/me/preferences` | View language and non-marketing notification preferences (restock channels) | Customer |
| PATCH | `/me/preferences` | Update those preferences | Customer |

Marketing consent is managed only through `/me/marketing-consents` (v1.1 amendments); `/me/preferences` never changes marketing consent.

Customer profile updates never rewrite historical order snapshots.

# 12. Guest Identity & Guest Order Linking

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | `/guest/orders/claim` | Start claim process | Authenticated customer |
| POST | `/guest/orders/claim/verify` | Verify OTP and link eligible guest orders | Authenticated customer |

A matching phone number alone is not sufficient proof of control. The claim OTP is emailed to the `guest_email` on the guest order(s); only orders whose phone and email both match are linked. Other guest orders are linked through support (Business Spec R31).

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
| POST | `/admin/products/{productId}/disable` | Disable | `PRODUCT_ARCHIVE` |
| POST | `/admin/products/{productId}/publish` | Publish | `PRODUCT_PUBLISH` |
| POST | `/admin/products/{productId}/unpublish` | Back to Draft | `PRODUCT_PUBLISH` |
| GET | `/admin/products/{productId}/variants` | List variants | `PRODUCT_VIEW` |
| POST | `/admin/products/{productId}/variants` | Create variant | `PRODUCT_CREATE` |
| PATCH | `/admin/variants/{variantId}` | Edit variant content (not price/cost) | `PRODUCT_EDIT` |
| POST | `/admin/variants/{variantId}/archive` | Archive variant | `PRODUCT_ARCHIVE` |
| PATCH | `/admin/variants/{variantId}/cost` | Edit cost values where allowed | `EDIT_COST_PRICE` |
| POST | `/admin/products/{productId}/media` | Attach an uploaded file (`mediaAssetId` from §28) as product/variant media | `MANAGE_PRODUCT_MEDIA` |
| DELETE | `/admin/products/{productId}/media/{mediaId}` | Remove media | `MANAGE_PRODUCT_MEDIA` |
| POST | `/admin/products/{productId}/price-review` | Create/review price change (per variant) | `EDIT_PRODUCT_PRICE` |
| GET/POST | `/admin/categories` | List / create categories | `PRODUCT_VIEW` / `TAXONOMY_MANAGE` |
| PATCH | `/admin/categories/{id}` | Edit / deactivate category | `TAXONOMY_MANAGE` |
| GET/POST | `/admin/brands` | List / create brands | `PRODUCT_VIEW` / `TAXONOMY_MANAGE` |
| PATCH | `/admin/brands/{id}` | Edit / deactivate brand | `TAXONOMY_MANAGE` |

Cost fields are returned only to callers with `VIEW_COST_PRICE`.

# 14. Cart

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/cart` | Get current cart | Guest/Customer |
| POST | `/cart/items` | Add item | Guest/Customer |
| PATCH | `/cart/items/{cartItemId}` | Update quantity/variant | Guest/Customer |
| DELETE | `/cart/items/{cartItemId}` | Remove item | Guest/Customer |
| POST | `/cart/reprice` | Revalidate prices/stock/discounts | Guest/Customer |
| POST | `/cart/merge` | Merge a guest cart into the customer cart after login | Customer |

Cart values are informational. Checkout revalidates all authoritative values.

Guest carts: the first cart write returns a random `guestCartToken`; guests send it back in `X-Guest-Cart-Token`. After login the client calls `POST /cart/merge` with that token. Merge rule for items present in both carts: `[BUSINESS DECISION REQUIRED]` (recommended: add quantities, capped by availability).

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
| POST | `/orders/{orderId}/confirm-cod` | Confirm COD via WhatsApp secure link (body: `token`); System then moves `Pending Confirmation → New`. Returns only a confirmation summary — no tracking or cancellation for guests (R16) | Secure COD token |
| POST | `/orders/{orderId}/revisions/{revisionId}/confirm` | Customer confirms a material order revision (C5) | Customer or secure COD token |

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
| POST | `/admin/orders/{orderId}/cancel` | Administrative cancellation (same window as customer cancellation; reason required) | `CANCEL_ORDER` |
| POST | `/admin/orders/{orderId}/approve-status-change` | Approve pending status request — **not used in v1** (Business Spec R19) | `APPROVE_ORDER_STATUS_CHANGE` |
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
| POST | `/admin/shipments/{shipmentId}/status` | Manual shipment status update (MVP): `OUT_FOR_DELIVERY`, `DELIVERY_FAILED` (records an attempt), `RETURN_TO_SENDER`, `RETURNED`, `DELIVERED`. `DELIVERED` also moves the order `SHIPPED → DELIVERED` in the same transaction | `MANAGE_SHIPMENT`; `DELIVERED` requires `MARK_AS_DELIVERED` |
| GET | `/admin/contact-tasks` | Customer-contact tasks after failed deliveries (Q129) | `CONTACT_TASK_MANAGE` |
| PATCH | `/admin/contact-tasks/{taskId}` | Assign / record outcome / resolve | `CONTACT_TASK_MANAGE` |

v1.2: delivery is recorded on the Shipment; the former `/admin/orders/{orderId}/mark-delivered` endpoint is replaced by the shipment status endpoint above.

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
| POST | `/returns/{returnId}/resubmit` | Submit a new request after rejection (creates a new return; the rejected one is unchanged, Q92) | Customer |
| POST | `/returns/{returnId}/cancel` | Withdraw a request while `PENDING_APPROVAL` | Customer |

Return requests are allowed until the end of the 14th calendar day after the delivery date in Africa/Cairo (delivery day is day 0; Business Spec R21). Evidence is mandatory for configured damage/wrong-item cases.

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
| POST | `/admin/return-items/{returnItemId}/resolution` | Choose the customer-caused outcome (R7): return to customer with no refund, or keep + configured partial wallet refund | `RESOLVE_CUSTOMER_CAUSED_RETURN` |
| POST | `/admin/returns/{returnId}/complete` | Complete the return; the eligible wallet refund is created automatically in the same transaction (Q97). Requires `Idempotency-Key` | `COMPLETE_RETURN` |

Inspection is item-level and supports `RESTOCK`, `DAMAGED`, or `REJECTED`, plus notes/evidence. Customer-caused opened/used items may result in return-to-customer/no-refund or a configured partial wallet refund, and the decision must be auditable.

# 18. Wallet

| Method | Endpoint | Purpose | Auth/Permission |
|---|---|---|---|
| GET | `/me/wallet` | Wallet summary | Customer |
| GET | `/me/wallet/transactions` | Wallet ledger | Customer |
| GET | `/admin/customers/{customerId}/wallet` | View customer wallet | `VIEW_WALLET_BALANCE` |
| POST | `/admin/customers/{customerId}/wallet/adjust` | Manual adjustment (reason required; `Idempotency-Key` required) | `ADJUST_WALLET` (Owner/Admin only) |
| POST | `/admin/returns/{returnId}/manual-refund` | Alternative future/manual refund (`Idempotency-Key` required) | `MANAGE_MANUAL_REFUNDS` |

v1.2: the separate `/admin/returns/{returnId}/refund` endpoint is removed; the wallet refund is part of `complete` (§17).

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
| POST | `/admin/purchases/{id}/approve` | Approve purchase | `PURCHASE_APPROVE` |
| POST | `/admin/purchases/{id}/send` | Approved → Sent to supplier | `PURCHASE_CREATE` |
| POST | `/admin/purchases/{id}/cancel` | Cancel before receiving | `PURCHASE_CREATE` (after approval: `PURCHASE_APPROVE`) |
| POST | `/admin/purchases/{id}/receive` | Goods receipt with inspection results; over-delivered extras create an approval request (Q116) | `RECEIVE_PURCHASE` |
| POST | `/admin/purchases/{id}/supplier-return` | Supplier return | `SUPPLIER_RETURN_MANAGE` |
| POST | `/admin/supplier-returns/{id}/submit` | Submit for Owner review (Q105) | `SUPPLIER_RETURN_MANAGE` |
| POST | `/admin/supplier-returns/{id}/settle` | Record refund/credit settlement (Q107, Q120) | `SUPPLIER_PAYMENT_MANAGE` |

Purchase invoices remain immutable. Quantity discrepancies are represented through receiving records.

# 22. Inventory

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/inventory` | Inventory overview | `INVENTORY_VIEW` |
| GET | `/admin/inventory/{variantId}` | Inventory details/history | `INVENTORY_VIEW` |
| POST | `/admin/inventory/{variantId}/adjust` | Manual stock adjustment | `ADJUST_INVENTORY` |
| GET | `/admin/inventory/{variantId}/movements` | Movement history | `INVENTORY_VIEW` |
| GET | `/admin/inventory/low-stock` | Variants at or below their low-stock threshold (Q21, Q110) | `INVENTORY_VIEW` |

v1.2: stock enters only through goods receipts (`/admin/purchases/{id}/receive`, Q101, Q104) or approved return inspections; the former `/admin/inventory/{variantId}/receive` is removed.

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
| POST | `/admin/campaigns/{id}/approve` | Final approval | `MARKETING_APPROVE` (Owner/Admin only) |
| POST | `/admin/campaigns/{id}/send` | Send campaign | `MARKETING_SEND` + approval |
| GET | `/admin/campaigns/{id}/delivery` | Delivery/failure stats | `MARKETING_VIEW` |

Marketing recipients require explicit marketing consent. Frequency limits are enforced server-side. Transactional notifications remain separate from marketing consent.

# 25. Employees, Roles & Permissions

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/employees` | Employee list | `EMPLOYEE_VIEW` |
| POST | `/admin/employees` | Invite employee by work email (Q64) | `EMPLOYEE_MANAGE` + hierarchy limits (Q65) |
| PATCH | `/admin/employees/{id}` | Edit employee / roles | `EMPLOYEE_MANAGE` + hierarchy limits |
| POST | `/admin/employees/{id}/deactivate` | Remove access without deleting history; revokes sessions | `EMPLOYEE_MANAGE` |
| POST | `/admin/employees/invitations/{id}/revoke` | Revoke a pending invitation | `EMPLOYEE_MANAGE` |
| GET | `/admin/roles` | Role list | `ROLE_VIEW` |
| POST | `/admin/roles` | Create custom role | `ROLE_MANAGE` (Owner/Admin only) |
| PATCH | `/admin/roles/{id}` | Edit role | `ROLE_MANAGE` (Owner/Admin only) |
| GET | `/admin/permissions` | Permission catalog | `ROLE_VIEW` |
| GET | `/admin/approval-requests` | List approval requests | `APPROVAL_RESOLVE` |
| GET | `/admin/approval-requests/{id}` | Approval request detail | `APPROVAL_RESOLVE` |
| POST | `/admin/approval-requests/{id}/approve` | Approve pending action | `APPROVAL_RESOLVE` (Owner/Admin only) |
| POST | `/admin/approval-requests/{id}/reject` | Reject pending action | `APPROVAL_RESOLVE` (Owner/Admin only) |

Managers may create employees but cannot create Managers, modify the permission model, or escalate permissions beyond their allowed scope.

# 26. Audit Logs & Settings

| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/audit-logs` | Search audit logs | `VIEW_AUDIT_LOGS` (Owner/Admin only) |
| GET | `/admin/settings` | Read settings | `SETTINGS_VIEW` |
| PATCH | `/admin/settings/{key}` | Change/propose setting | `SETTINGS_MANAGE` (Owner/Admin only) |
| GET | `/admin/settings/history` | Setting history | `SETTINGS_VIEW` |

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
| GET | `/admin/analytics/profit` | Estimated gross profit | `VIEW_PROFIT` |

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

v1.2: this is the **only** upload flow. `POST /files/complete` returns a `mediaAssetId`, which feature endpoints attach (product media §13, return evidence §17, supplier invoices §21). Uploading requires the permission of the feature the file is for (for example `MANAGE_PRODUCT_MEDIA`), or customer ownership of the return.

# 29. Stable Error Codes

```text
UNAUTHENTICATED
AUTH_INVALID_CREDENTIALS
AUTH_OTP_INVALID
AUTH_OTP_EXPIRED
AUTH_EMAIL_NOT_VERIFIED
AUTH_RATE_LIMITED
RATE_LIMITED
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
- Return eligibility is measured from the actual delivery date and closes at the end of the 14th calendar day after it, in Africa/Cairo (Business Spec R21).
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


## v1.1 Closure Decisions and Audit Corrections

The canonical text of closure decisions C1–C6 and of the Pre-Implementation Audit Corrections 1–10 lives only in `docs/product/business-spec.md`. The copies that used to be repeated here were removed in TASK-002A to prevent the documents drifting apart.

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

v1.2: the `reminder-settings` endpoints are removed. Cadence and maximum are fixed by Business Spec R6, and reminders are controlled by the customer's marketing consent (`/me/marketing-consents`). Restock `Notify Me` remains an explicit independent subscription.

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

## TASK-002A Amendments (v1.2)

Added by TASK-002A. Permission codes in this contract come only from `docs/security/permission-catalog.md` (Business Spec R17).

### Admin customers
| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/customers` | Search customers | `CUSTOMER_VIEW` |
| GET | `/admin/customers/{customerId}` | Customer detail and order history; phone/addresses only with `VIEW_CUSTOMER_CONTACT` (Q80) | `CUSTOMER_VIEW` |

### Review moderation
| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/reviews` | Reviews, including reported and hidden | `REVIEW_MODERATE` |
| POST | `/admin/reviews/{reviewId}/hide` | Hide with a reason; history kept (Q174) | `REVIEW_MODERATE` |
| POST | `/admin/reviews/{reviewId}/restore` | Restore a hidden review | `REVIEW_MODERATE` |

### Supplier finance permissions
`GET /admin/suppliers/{id}/ledger` and `/balance` require `SUPPLIER_FINANCE_VIEW`; `POST /admin/purchases/{id}/invoice` and `POST /admin/suppliers/{id}/payments` require `SUPPLIER_PAYMENT_MANAGE`.

### Staff notifications and delivery logs
| Method | Endpoint | Purpose | Permission |
|---|---|---|---|
| GET | `/admin/me/notifications` | Staff in-app notifications (e.g. low stock) | Employee |
| POST | `/admin/me/notifications/{id}/read` | Mark as read | Employee |
| GET | `/admin/notifications/deliveries` | WhatsApp/email delivery attempts and failures | `NOTIFICATION_LOG_VIEW` |

### Idempotency (completes §9)
`Idempotency-Key` is required on: `POST /checkout`, `POST /admin/returns/{id}/complete`, `POST /admin/returns/{id}/manual-refund`, `POST /admin/customers/{id}/wallet/adjust`, `POST /admin/suppliers/{id}/payments`. Webhooks use the provider's event id as the key. Stored in `idempotency_keys` (DB v1.2 amendments).

## TASK-002 Foundation Amendments

Technical conventions only; no business behavior changed. See `docs/decisions/ADR-0004-api-foundation.md`.

- All endpoints in this contract are served under `/api/v1` (§3) by the backend in `src/server` (ADR-0001).
- Error conventions and the default HTTP status per error code: §6.1.

### Operational endpoints

Not business endpoints. Unauthenticated, and they expose no internal details.

| Method | Endpoint | Purpose | Response |
|---|---|---|---|
| GET | `/health` | Liveness (no dependency checks) | `200 { data: { status: "ok" }, meta }` |
| GET | `/health/ready` | Readiness (database reachable within 2 s) | `200 { data: { status: "ready", checks: { database: "up" } }, meta }` or `503` with `status: "not_ready"`, `database: "down"` |

## TASK-007 Amendments (customer authentication core)

Added by TASK-007 (`docs/tasks/TASK-007-customer-auth-core.md`). Business rules: Business Spec R23–R27. Technical design: ADR-0013. Verification, activation and password recovery endpoints are TASK-008.

### Transport
- **Bearer (default, mobile):** `/auth/login` and `/auth/refresh` return `data.tokens` = `{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }`. Send `Authorization: Bearer <accessToken>`; send `{ "refreshToken": "…" }` to `/auth/refresh`.
- **Cookie (website):** with `X-Auth-Transport: cookie`, the tokens are set as `__Host-bf_at` (access, `Path=/`) and `__Secure-bf_rt` (refresh, `Path=/api/v1/auth`), both `HttpOnly; Secure; SameSite=Lax`, and `data.tokens` is omitted. `/auth/refresh` with the refresh cookie and an empty body answers with new cookies. `/auth/logout` and `/auth/logout-all` clear the cookies.
- **CSRF:** state-changing requests authenticated by cookie, and login/refresh in cookie mode, must carry an allowed `Origin` (or `Referer`); otherwise `403 FORBIDDEN`. Any request that carries a foreign `Origin` is rejected the same way. Bearer requests without `Origin` (native apps) are not affected.
- Access tokens last 15 minutes. A session lasts 30 days from login and refreshing does not extend it (R23). Each refresh returns a new pair; a refresh token that was already used revokes the whole session unless it is presented again within 10 seconds (ADR-0013).

### Endpoints
| Endpoint | Request body | Success |
|---|---|---|
| `POST /auth/register` | `{ email, password, phone, fullName, preferredLocale? }` | `201` `{ accountId, customerId, status: "PENDING_VERIFICATION", emailVerified: false, phoneVerified: false, pendingExpiresAt }`. No tokens. |
| `POST /auth/login` | `{ email, password }` | `200` `{ account, customer, session: { expiresAt }, tokens? }` |
| `POST /auth/refresh` | `{ refreshToken? }` (omit when using the cookie) | `200` same shape as login |
| `POST /auth/logout` | — | `204` |
| `POST /auth/logout-all` | — | `204` |
| `POST /auth/change-password` | `{ currentPassword, newPassword }` | `204` |
| `GET /auth/session` | — | `200` `{ account, customer, session: { expiresAt } }` |

- `account` = `{ id, email, status, emailVerified, phoneVerified }`; `customer` = `{ id, fullName, phone, preferredLocale }`.
- `preferredLocale` (`ar` | `en`) defaults to `Accept-Language`, then `ar` (R14).
- `email` is trimmed and lowercased. `phone` must be an Egyptian mobile number (`01xxxxxxxxx`, `+201xxxxxxxxx` or `00201xxxxxxxxx`) and is returned in E.164 (R27). `fullName` is 1–100 characters.
- `VALIDATION_ERROR` issue codes include `password_too_short`, `password_too_long`, `password_common` (Q156) and `phone_invalid` (R27).
- `/auth/logout`, `/auth/logout-all`, `/auth/change-password` and `/auth/session` also accept a `PENDING_VERIFICATION` account with a verified email (R26). Every other customer endpoint requires `ACTIVE`.

### Errors
| Case | Response |
|---|---|
| Duplicate **verified** email (Q151) / verified phone | `409 CONFLICT`, `details.field` = `email` / `phone`. An unverified pending registration is replaced instead (R25). |
| Unknown email or wrong password | `401 AUTH_INVALID_CREDENTIALS` (same response for both) |
| Correct password, email not verified | `403 AUTH_EMAIL_NOT_VERIFIED` (R26) |
| Suspended or deactivated account | `403 FORBIDDEN` |
| Account locked (5 consecutive failures, R24), IP blocked (30 failures / 15 min), or too many registrations from one IP (10 / hour) | `429 AUTH_RATE_LIMITED`, `details.retryAfterSeconds` |
| Wrong current password on change-password | `401 AUTH_INVALID_CREDENTIALS` (counts toward the R24 lock) |
| Missing, invalid, expired or revoked token | `401 UNAUTHENTICATED` |
