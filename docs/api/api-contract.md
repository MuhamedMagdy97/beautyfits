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

Changing email or phone requires re-authentication plus an email OTP: to the new email for an email change, to the verified account email for a phone change (Business Spec R30). The old contact method should also receive a security notification where appropriate.

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
| GET | `/employee-auth/session` | Current employee and session limits (TASK-011) | Employee |
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
| GET | `/admin/employees/invitations` | Invitation list (TASK-012) | `EMPLOYEE_VIEW` |
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

Added by TASK-007 (`docs/tasks/TASK-007-customer-auth-core.md`). Business rules: Business Spec R23–R27. Technical design: ADR-0013. Verification, activation and password recovery endpoints are in "TASK-008 Amendments".

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

## TASK-008 Amendments (email codes and password recovery)

Added by TASK-008 (`docs/tasks/TASK-008-email-otp-recovery.md`). Business rules: Q42, Q158–Q161, R23, R30. Technical design: ADR-0014. All endpoints below are public (no token), accept JSON, and apply the `Origin` check of the TASK-007 amendments.

### Endpoints
| Endpoint | Request body | Success |
|---|---|---|
| `POST /auth/register` | unchanged | `201`, adds `verificationCodeSent: boolean` (false when the email's send limit was reached or the email could not be sent) |
| `POST /auth/verify-email-otp` | `{ email, code }` | `200` `{ accountId, status: "ACTIVE", emailVerified: true }`. No tokens; the client logs in next. |
| `POST /auth/resend-otp` | `{ email, purpose }`, `purpose` = `EMAIL_VERIFICATION` or `PASSWORD_RESET` | `202` `{ cooldownSeconds: 60 }` |
| `POST /auth/forgot-password` | `{ email }` | `202` `{ cooldownSeconds: 60 }` |
| `POST /auth/verify-recovery-otp` | `{ email, code }` | `200` `{ resetToken, resetTokenExpiresAt }` (single use, 10 minutes) |
| `POST /auth/reset-password` | `{ resetToken, newPassword }` | `204`. Every session of the account is revoked (R23); the customer logs in again. |

- `code` is exactly 6 digits. `email` is normalized as for login. `newPassword` follows the password policy (Q156).
- Codes are emailed in the customer's `preferredLocale`. A new code replaces the previous one for the same purpose and email.
- `resend-otp` and `forgot-password` answer `202` the same way whether or not an eligible account exists. A verification code goes only to an unexpired `PENDING_VERIFICATION` account with that unverified email; a reset code only to an `ACTIVE` account with that verified email.

### Errors
| Case | Response |
|---|---|
| Wrong code, no open code, or a used/superseded code | `401 AUTH_OTP_INVALID`; after a counted attempt `details.attemptsRemaining` (0 once the 5 attempts are used, Q158) |
| Code older than 5 minutes (Q159), or pending account expired | `401 AUTH_OTP_EXPIRED` |
| Unknown or already used reset token | `401 AUTH_OTP_INVALID` |
| Reset token older than 10 minutes | `401 AUTH_OTP_EXPIRED` |
| New code within 60 s (Q160), more than 5 codes per hour for a purpose and email, more than 20 code requests per hour from one IP, or 30 wrong codes from one IP in 15 minutes | `429 AUTH_RATE_LIMITED`, `details.retryAfterSeconds` |
| Email or phone verified by another account first | `409 CONFLICT`, `details.field` = `email` / `phone` |
| Account suspended or deactivated | `403 FORBIDDEN` |

## TASK-011 Amendments (employee login)

Added by TASK-011 (`docs/tasks/TASK-011-employee-auth.md`). Business rules: R15, R24 values, R28, R29, R30, Q158–Q161, Q163. Technical design: ADR-0015. All endpoints accept JSON and apply the `Origin` check of the TASK-007 amendments.

### Transport
- Same two transports as customers. With `X-Auth-Transport: cookie` the employee tokens are set as `__Host-bfe_at` (access, `Path=/`) and `__Secure-bfe_rt` (refresh, `Path=/api/v1/employee-auth`), separate from the customer cookies, and a trusted device as `__Secure-bfe_dt` (`Path=/api/v1/employee-auth`, 30 days). All are `HttpOnly; Secure; SameSite=Lax`.
- Bearer clients receive `tokens` and, after a code, `deviceToken` in the body, and send `deviceToken` back in the login body.
- Access tokens last 15 minutes. A staff session lasts at most 12 hours from login and ends after 60 minutes without activity (R29 defaults, Owner/Admin-configurable). Refreshing does not extend either limit and is not activity.

### Endpoints
| Endpoint | Request body | Success |
|---|---|---|
| `POST /employee-auth/login` | `{ email, password, deviceToken? }` (cookie clients send the device cookie instead) | Trusted device: `200` signed-in body. Otherwise `202` `{ otpRequired: true, codeSent, loginTicket, loginTicketExpiresAt, cooldownSeconds: 60 }` and a code is emailed. |
| `POST /employee-auth/verify-otp` | `{ loginTicket, code }` | `200` signed-in body plus `deviceTrustedUntil` (and `deviceToken` for Bearer). The device is trusted for 30 days (R28). |
| `POST /employee-auth/resend-otp` | `{ loginTicket }` | `202` `{ otpRequired: true, loginTicket, loginTicketExpiresAt, cooldownSeconds: 60 }`: a new code and a new ticket; the old ticket stops working. |
| `POST /employee-auth/refresh` | `{ refreshToken? }` (omit when using the cookie) | `200` signed-in body |
| `POST /employee-auth/logout` | — | `204`; the device stays trusted |
| `POST /employee-auth/logout-all` | — | `204` |
| `GET /employee-auth/session` | — | `200` `{ account, employee, session }` (new endpoint, as `GET /auth/session` for customers) |
| `POST /employee-auth/forgot-password` | `{ email }` | `202` `{ cooldownSeconds: 60 }`, the same for any email |
| `POST /employee-auth/reset-password` | `{ email, code, newPassword }` | `204`. Every session of the employee is revoked (R29); the employee signs in again. |

- Signed-in body: `{ account: { id, email, status }, employee: { id, displayName, level, department }, session: { expiresAt, idleTimeoutSeconds }, tokens? }`.
- The login ticket is valid for 15 minutes after the password check, resends included. `code` is exactly 6 digits; `newPassword` follows the password policy (Q156).
- `POST /employee-auth/accept-invitation` (Q64) is implemented by TASK-012 (see "TASK-012 Amendments").

### Errors
| Case | Response |
|---|---|
| Unknown email or wrong password | `401 AUTH_INVALID_CREDENTIALS` (same response) |
| Correct password, account or employee not active | `403 FORBIDDEN` |
| Employee login locked (5 consecutive failures) or IP blocked (30 failures / 15 min); code request within 60 s, more than 5 per hour, more than 20 per hour from one IP; 30 wrong codes from one IP in 15 minutes | `429 AUTH_RATE_LIMITED`, `details.retryAfterSeconds` |
| Wrong code, unknown or replaced ticket, used ticket | `401 AUTH_OTP_INVALID`; after a counted attempt `details.attemptsRemaining` |
| Code older than 5 minutes, or ticket older than 15 minutes | `401 AUTH_OTP_EXPIRED` |
| Missing, invalid, expired, revoked or idle session | `401 UNAUTHENTICATED` |
| Customer token on an employee endpoint (or the reverse) | `403 FORBIDDEN` |

## TASK-012 Amendments (roles, permissions, invitations)

Added by TASK-012 (`docs/tasks/TASK-012-roles-permissions.md`). Business rules: Q64–Q69, R15, R17, R18, User Flows §17, the permission catalog. Technical design and defaults: ADR-0016. Admin endpoints use the employee session of the TASK-011 amendments (Bearer or the employee cookie with the `Origin` check).

### Authorization
- Owner and Admin hold every permission. Managers and Employees hold the union of their roles' permissions, without the Owner/Admin-only permissions of the catalog §2. Changes apply to the next request.
- A missing permission: `403 PERMISSION_DENIED`, `details.requiredPermissions`.
- Hierarchy (Q65): the Owner manages Admins, Managers and Employees; an Admin manages Managers and Employees; a Manager manages Employees and gives or takes away only roles whose permissions they hold; an Employee manages nobody; nobody is made Owner. Violations: `403 PERMISSION_DENIED` with `details.reason` = `HIERARCHY`, `ROLE_OUTSIDE_SCOPE` (+ `roleIds`), `SELF` or `SYSTEM_ROLE`.
- `GET /employee-auth/session` also returns `permissions`: the employee's effective codes in catalog order.

### Endpoints
| Endpoint | Request | Success |
|---|---|---|
| `GET /admin/permissions` | — | `200` `[{ code, group, description, ownerAdminOnly }]` |
| `GET /admin/roles` | — | `200` `[role]` |
| `POST /admin/roles` | `{ name, description?, permissions: [code] }` | `201` `role` |
| `PATCH /admin/roles/{id}` | any of `{ name, description, permissions }` (`permissions` replaces the set) | `200` `role` |
| `GET /admin/employees` | query `page`, `pageSize` (max 100), `status`, `level`, `search` (name or email) | `200` `[employee]` + `meta.pagination` |
| `POST /admin/employees` | `{ email, displayName, department?, level: ADMIN \| MANAGER \| EMPLOYEE, roleIds?: [uuid] }` | `201` `{ invitation, emailSent }` |
| `PATCH /admin/employees/{id}` | any of `{ displayName, department, level, roleIds }` (`roleIds` replaces the set) | `200` `employee` |
| `POST /admin/employees/{id}/deactivate` | — | `200` `employee` (sessions and trusted devices revoked) |
| `GET /admin/employees/invitations` | query `page`, `pageSize`, `status` = `PENDING` \| `ACCEPTED` \| `REVOKED` \| `EXPIRED` | `200` `[invitation]` + `meta.pagination` (new endpoint) |
| `POST /admin/employees/invitations/{id}/revoke` | — | `200` `invitation` |
| `POST /employee-auth/accept-invitation` | `{ invitationToken, password }` | `201` `{ account: { id, email, status }, employee: { id, displayName, level, department } }`; not signed in (the first login asks for an email code, R28) |

- `role`: `{ id, name, description, isSystemRole, permissions: [code], employeeCount, createdAt, updatedAt }`.
- `employee`: `{ id, accountId, email, displayName, level, department, status, roles: [{ id, name }], createdByEmployeeId, createdAt, deactivatedAt }`.
- `invitation`: `{ id, email, displayName, department, level, roles: [{ id, name }], status, invitedBy: { id, displayName }, expiresAt, createdAt, acceptedAt, revokedAt }`.
- The invitation email links to `<DASHBOARD_URL>/staff/accept-invitation#token=<invitationToken>`; the dashboard page (TASK-052) reads the token from the fragment. An invitation is valid for 7 days.

### Errors
| Case | Response |
|---|---|
| Unknown role id, system role in `roleIds`, unknown permission code, Owner/Admin-only permission in a role | `400 VALIDATION_ERROR` (issue codes `role_not_found`, `role_system`, `permission_unknown`, `permission_owner_admin_only`) |
| Role name already used (ignoring case) | `409 CONFLICT`, `details.reason = ROLE_NAME_TAKEN` |
| Email already an employee, or already has a pending invitation | `409 CONFLICT`, `details.reason` = `EMPLOYEE_EXISTS` / `INVITATION_PENDING` (+ `invitationId`) |
| Revoking an invitation that is not pending | `409 CONFLICT`, `details.reason = INVITATION_NOT_PENDING` |
| Unknown or malformed employee, role or invitation id | `404 NOT_FOUND` |
| Invitation token unknown, used, revoked, or no longer allowed for its inviter | `401 AUTH_OTP_INVALID` |
| Invitation expired | `401 AUTH_OTP_EXPIRED` |
| 30 rejected invitation tokens from one IP in 15 minutes | `429 AUTH_RATE_LIMITED`, `details.retryAfterSeconds` |

## TASK-013 Amendments (approval requests, audit logs)

Added by TASK-013 (`docs/tasks/TASK-013-approvals-audit.md`). Business rules: Q70, Q79, Audit Correction 7, R19, User Flows §17.3 and §18. Technical design and defaults: ADR-0018. Both groups of endpoints use the employee session (Bearer, or the employee cookie with the `Origin` check). `APPROVAL_RESOLVE` and `VIEW_AUDIT_LOGS` are Owner/Admin-only (permission catalog §2): a Manager or Employee gets `403 PERMISSION_DENIED` whatever their roles contain.

### Approval requests (§25)
Requests are created by the features that need them (R19: purchase orders, over-delivery extras, marketing campaigns, critical settings); there is no endpoint to create one. Those features' own endpoints answer as their tasks define.

| Endpoint | Request | Success |
|---|---|---|
| `GET /admin/approval-requests` | query `page`, `pageSize` (max 100), `status` = `PENDING` \| `APPROVED` \| `REJECTED` \| `CANCELLED`, `approvalType`, `entityType`, `entityId` | `200` `[approvalRequest]` newest first + `meta.pagination` |
| `GET /admin/approval-requests/{id}` | — | `200` `approvalRequest` |
| `POST /admin/approval-requests/{id}/approve` | optional `{ reason? }` (max 1000 characters) | `200` `approvalRequest`; the feature's pending action is applied in the same transaction |
| `POST /admin/approval-requests/{id}/reject` | `{ reason }` (required, 1–1000 characters) | `200` `approvalRequest` |

- `approvalRequest`: `{ id, approvalType, entityType, entityId, status, reason, metadata, requestedBy: { id, displayName }, requestedAt, resolvedBy: { id, displayName } | null, resolvedAt, resolutionReason }`. `approvalType` = `PURCHASE_ORDER` \| `PURCHASE_OVER_DELIVERY` \| `MARKETING_CAMPAIGN` \| `CRITICAL_SETTING`. `reason` is the requester's; `resolutionReason` the resolver's. `metadata` is what the feature recorded about the pending action.

| Case | Response |
|---|---|
| Request is no longer `PENDING` | `409 CONFLICT`, `details.reason = APPROVAL_NOT_PENDING`, `details.status` |
| Resolving one's own request | `403 PERMISSION_DENIED`, `details.reason = SELF_APPROVAL` |
| Reject without a reason | `400 VALIDATION_ERROR` |
| Unknown or malformed id | `404 NOT_FOUND` |
| The feature refuses the action (for example, the entity changed since the request) | the feature's error; the request stays `PENDING` |
| A feature opens a second request for the same type and entity while one is pending | `409 CONFLICT`, `details.reason = APPROVAL_PENDING` (+ `approvalRequestId`) |

### Audit logs (§26)
| Endpoint | Request | Success |
|---|---|---|
| `GET /admin/audit-logs` | query `page`, `pageSize` (max 100), `actorType` = `SYSTEM` \| `EMPLOYEE` \| `CUSTOMER`, `actorId` (uuid), `action`, `entityType`, `entityId`, `from` (inclusive), `to` (exclusive); `from`/`to` are ISO 8601 date-times with an offset | `200` `[auditLog]` newest first + `meta.pagination` |

- `auditLog`: `{ id, actor: { type, id, displayName }, action, entityType, entityId, previousData, newData, reason, correlationId, createdAt }`. `displayName` is the employee's current name for employee actors, otherwise null. `correlationId` is the `X-Request-Id` of the API request that made the change (null for the bootstrap).
- Actions so far: `OWNER_BOOTSTRAPPED`, `ROLE_SEEDED`, `ROLE_CREATED`, `ROLE_UPDATED`, `EMPLOYEE_INVITED`, `EMPLOYEE_INVITATION_REVOKED`, `EMPLOYEE_INVITATION_ACCEPTED`, `EMPLOYEE_UPDATED`, `EMPLOYEE_DEACTIVATED`, `APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `APPROVAL_CANCELLED`. Later tasks add their own; codes are never renamed.
- Entries are read-only: there is no endpoint to change or delete one.
- Invalid filters (unknown `actorType`, malformed `actorId` or date, `from` not before `to`): `400 VALIDATION_ERROR`.

## TASK-014 Amendments (products and variants)

Added by TASK-014 (`docs/tasks/TASK-014-products-variants.md`). Business rules: C6, Q73, Q75, R14, R19, User Flows §4.1. Technical design and defaults: ADR-0019. The endpoints use the employee session (Bearer, or the employee cookie with the `Origin` check). Product and variant changes need no approval request (R19).

### Endpoints (§13)
| Endpoint | Permission | Request | Success |
|---|---|---|---|
| `POST /admin/products` | `PRODUCT_CREATE` | `{ nameAr, nameEn, slug?, descriptionAr?, descriptionEn?, defaultVariant: variantInput }` | `201` `product` (status `DRAFT`, one default variant) |
| `GET /admin/products` | `PRODUCT_VIEW` | query `page`, `pageSize` (max 100), `status`, `search` (names, slug or SKU) | `200` `[productSummary]` newest first + `meta.pagination` |
| `GET /admin/products/{id}` | `PRODUCT_VIEW` | — | `200` `product` |
| `PATCH /admin/products/{id}` | `PRODUCT_EDIT` | any of `{ nameAr, nameEn, slug, descriptionAr, descriptionEn }` | `200` `product` |
| `GET /admin/products/{id}/variants` | `PRODUCT_VIEW` | — | `200` `[variant]` in creation order, archived included |
| `POST /admin/products/{id}/variants` | `PRODUCT_CREATE` | `variantInput` | `201` `variant` (not default) |
| `PATCH /admin/variants/{id}` | `PRODUCT_EDIT` | any of `{ sku, nameAr, nameEn, attributes, isDefault: true }` | `200` `variant` |
| `POST /admin/variants/{id}/archive` | `PRODUCT_ARCHIVE` | — | `200` `variant`; repeating it returns the same result |

- `variantInput`: `{ sku, nameAr?, nameEn?, attributes? }`. `sku`: 1–64 letters, digits and single `-` `_` `.` between them, returned in capitals. Variant names come in pairs (both or neither). `attributes`: object of up to 20 text values, or `null`.
- `slug`: lowercase Latin letters, digits and single hyphens, max 120. Omitted on create: made from `nameEn`. Blank descriptions become `null`.
- `product`: `{ id, nameAr, nameEn, slug, descriptionAr, descriptionEn, status, variants: [variant], createdAt, updatedAt, archivedAt }`.
- `productSummary`: `{ id, nameAr, nameEn, slug, status, defaultVariant: { id, sku }, activeVariantCount, createdAt, updatedAt }`.
- `variant`: `{ id, productId, sku, isDefault, nameAr, nameEn, attributes, status: ACTIVE | ARCHIVED, createdAt, updatedAt, archivedAt }`.
- Prices and costs are not part of these responses yet (TASK-018). Publishing, archiving and disabling products and media come with TASK-016–017; brands and categories with TASK-015 (see "TASK-015 Amendments").
- Audit actions added: `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_VARIANT_CREATED`, `PRODUCT_VARIANT_UPDATED`, `PRODUCT_VARIANT_ARCHIVED` (entity types `PRODUCT`, `PRODUCT_VARIANT`).

### Errors
| Case | Response |
|---|---|
| Invalid body or query; a variant name in one language only; `isDefault: false` | `400 VALIDATION_ERROR` (issue code `variant_name_pair` for names) |
| No slug given and the English name has no Latin letter or digit | `400 VALIDATION_ERROR`, issue `slug` / `slug_required` |
| Slug used by another product | `409 CONFLICT`, `details.reason = SLUG_TAKEN` (+ `slug`) |
| SKU used by another variant, archived ones included | `409 CONFLICT`, `details.reason = SKU_TAKEN` (+ `sku`) |
| Changing the slug of a product that is not `DRAFT` | `409 CONFLICT`, `details.reason = SLUG_LOCKED` |
| Changing an `ARCHIVED` product or its variants | `409 CONFLICT`, `details.reason = PRODUCT_ARCHIVED` |
| Editing an archived variant, or making it the default | `409 CONFLICT`, `details.reason = VARIANT_ARCHIVED` |
| Archiving the default variant | `409 CONFLICT`, `details.reason = VARIANT_IS_DEFAULT` |
| More than 100 variants on one product | `409 CONFLICT`, `details.reason = VARIANT_LIMIT` |
| Unknown or malformed product or variant id | `404 NOT_FOUND` |

## TASK-015 Amendments (brands and categories)

Added by TASK-015 (`docs/tasks/TASK-015-brands-categories.md`). Business rules: Q75, R14, R19. Technical design and defaults: ADR-0020. Same employee session and `Origin` rules as TASK-014. No approval requests (R19).

### Endpoints (§13)
| Endpoint | Permission | Request | Success |
|---|---|---|---|
| `GET /admin/brands` | `PRODUCT_VIEW` | query `page`, `pageSize` (max 100), `status`, `search` (names or slug) | `200` `[brand]` by English name + `meta.pagination` |
| `POST /admin/brands` | `TAXONOMY_MANAGE` | `{ nameAr, nameEn, slug?, descriptionAr?, descriptionEn? }` | `201` `brand` (status `ACTIVE`) |
| `PATCH /admin/brands/{id}` | `TAXONOMY_MANAGE` | any of `{ nameAr, nameEn, slug, descriptionAr, descriptionEn, status }` | `200` `brand` |
| `GET /admin/categories` | `PRODUCT_VIEW` | query `status` | `200` `[category]`, the whole tree: each category followed by its subcategories, siblings by English name |
| `POST /admin/categories` | `TAXONOMY_MANAGE` | `{ nameAr, nameEn, slug?, parentId? }` | `201` `category` (status `ACTIVE`) |
| `PATCH /admin/categories/{id}` | `TAXONOMY_MANAGE` | any of `{ nameAr, nameEn, slug, parentId, status }` | `200` `category` |

- `status`: `ACTIVE` or `INACTIVE`. Setting `INACTIVE` deactivates, `ACTIVE` reactivates. Nothing is deleted.
- `slug`: same format as product slugs; made from `nameEn` when omitted. Brand slugs are unique; category slugs are unique among categories with the same parent. `parentId: null` moves a category to the top level.
- `brand`: `{ id, nameAr, nameEn, slug, descriptionAr, descriptionEn, status, productCount, createdAt, updatedAt }`.
- `category`: `{ id, nameAr, nameEn, slug, parentId, depth (1 = top level), status, productCount, createdAt, updatedAt }`.
- Audit actions added: `BRAND_CREATED`, `BRAND_UPDATED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED` (entity types `BRAND`, `CATEGORY`).

### Product changes
- `POST /admin/products` also takes `brandId?` and `categoryIds?`; `PATCH /admin/products/{id}` also takes `brandId` (`null` removes it) and `categoryIds` (the full list; `[]` removes all). At most 10 categories; duplicates are ignored.
- `product` gains `brand: brandRef | null` and `categories: [categoryRef]` (by English name); `productSummary` gains `brand`. `brandRef`: `{ id, nameAr, nameEn, slug, status }`; `categoryRef` adds `parentId`.
- `GET /admin/products` gains the filters `brandId` and `categoryId` (products listed directly in that category).
- Product audit snapshots include `brandId` and `categoryIds`.

### Errors
| Case | Response |
|---|---|
| Invalid body or query | `400 VALIDATION_ERROR` |
| No slug given and the English name has no Latin letter or digit | `400 VALIDATION_ERROR`, issue `slug` / `slug_required` |
| Unknown `parentId`, `brandId` or category id in the body | `400 VALIDATION_ERROR`, issue code `category_not_found` / `brand_not_found` |
| Slug used by another brand, or by a sibling category | `409 CONFLICT`, `details.reason = SLUG_TAKEN` (+ `slug`) |
| Category deeper than 3 levels, by creating or moving | `409 CONFLICT`, `details.reason = CATEGORY_DEPTH_LIMIT` |
| Moving a category under itself or one of its subcategories | `409 CONFLICT`, `details.reason = CATEGORY_LOOP` |
| Deactivating a category that has active subcategories | `409 CONFLICT`, `details.reason = CATEGORY_HAS_ACTIVE_CHILDREN` |
| Creating, moving or reactivating an active category under an inactive parent | `409 CONFLICT`, `details.reason = PARENT_INACTIVE` |
| Linking a product to an inactive brand or category | `409 CONFLICT`, `details.reason = BRAND_INACTIVE` / `CATEGORY_INACTIVE` |
| Unknown or malformed brand or category id in the path | `404 NOT_FOUND` |
