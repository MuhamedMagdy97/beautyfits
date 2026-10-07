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

Guest carts: the first cart write returns a random `guestCartToken`; guests send it back in `X-Guest-Cart-Token`. After login the client calls `POST /cart/merge` with that token. Merge rule for items present in both carts: the quantities are added, capped at the quantity available (Business Spec R33). Details: "TASK-025 Amendments".

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

Wishlist is account-only. Out-of-stock items may remain visible. `Notify Me` is a separate explicit subscription. Wishlist details: "TASK-042 Amendments".

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

## TASK-016 Amendments (product media and uploads)

Added by TASK-016 (`docs/tasks/TASK-016-product-media.md`). Business rules: Q175–Q178, R14, R19. Technical design and defaults: ADR-0021. Session endpoints use the employee session (Bearer, or the employee cookie with the `Origin` check). No approval requests (R19).

### Uploads (§28)
| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `POST /files/upload-init` | Employee with the purpose's permission (`MANAGE_PRODUCT_MEDIA` for `PRODUCT_MEDIA`) | `{ purpose: "PRODUCT_MEDIA", filename, mimeType, sizeBytes }` | `201` `{ mediaAssetId, upload: { method: "PUT", url, headers, expiresAt } }` |
| `PUT <upload.url>` (local storage: `/files/uploads/{id}`) | The `X-Upload-Token` header from `upload.headers` (no session) | the file's bytes, with every header in `upload.headers` | `204` |
| `POST /files/complete` | The employee who started the upload | `{ mediaAssetId }` | `200` `mediaAsset` (`scanStatus: SAFE`); repeating it returns the same result |
| `GET /files/{id}/content` | Public for current images of `PUBLISHED` products; otherwise an employee with `PRODUCT_VIEW` or `MANAGE_PRODUCT_MEDIA` | `If-None-Match` optional | `200` the file (checked `Content-Type`, `X-Content-Type-Options: nosniff`, sandbox CSP, `ETag`), or `304` |

- `mimeType`: `image/jpeg`, `image/png` or `image/webp`; `filename` must end in a matching extension (`.jpg`/`.jpeg`, `.png`, `.webp`) and is kept for display only (path parts removed, max 255). `sizeBytes`: 1 to 5 MB (5 242 880).
- The upload authorization is single-use and valid for 15 minutes (`expiresAt`). Sending again before completing replaces the earlier bytes. Clients send the bytes to `upload.url` with exactly `upload.headers`; with a future storage provider the URL and headers change, the steps do not.
- Completing checks the stored file: type from its content (must match `mimeType`), size, dimensions (500–6000 pixels on each side), one well-formed image with nothing appended and no animation, and the security scan. A refused file becomes `REJECTED` and its bytes are deleted.
- `mediaAsset`: `{ id, purpose, originalFilename, mimeType, sizeBytes, width, height, scanStatus: PENDING | SAFE | REJECTED, url, createdAt, completedAt }`; `url` is `/api/v1/files/{id}/content`.
- At most 300 uploads started per employee per hour.

### Product media (§13)
| Endpoint | Permission | Request | Success |
|---|---|---|---|
| `POST /admin/products/{id}/media` | `MANAGE_PRODUCT_MEDIA` | `{ mediaAssetId, variantId?, altTextAr?, altTextEn?, isMain? }` | `201` `productMedia` |
| `PATCH /admin/products/{id}/media/{mediaId}` | `MANAGE_PRODUCT_MEDIA` | any of `{ variantId, altTextAr, altTextEn, isMain: true }` | `200` `productMedia` |
| `DELETE /admin/products/{id}/media/{mediaId}` | `MANAGE_PRODUCT_MEDIA` | — | `200` `[productMedia]`, the remaining images |
| `PUT /admin/products/{id}/media/order` | `MANAGE_PRODUCT_MEDIA` | `{ mediaIds }`: every current image once, in the new order | `200` `[productMedia]` |

- `productMedia`: `{ id, productId, variantId, mediaAssetId, url, mimeType, width, height, sizeBytes, sortOrder, isMain, altTextAr, altTextEn, createdAt, updatedAt }`.
- `variantId`: one of the product's active variants, or `null` for the whole product. Alt text: max 250 characters; blank becomes `null`.
- The first image becomes the main image; `isMain: true` moves it; removing the main image makes the first remaining image main. `isMain: false` is not accepted on `PATCH`.
- Removing hides the image (the record and file are kept for history). At most `catalog.max_images_per_product` current images (default 20, variant images included).
- `product` gains `media: [productMedia]` (current images in order); `productSummary` gains `mainImage: { id, url, width, height, altTextAr, altTextEn } | null`.
- Audit actions added: `PRODUCT_MEDIA_ADDED`, `PRODUCT_MEDIA_UPDATED`, `PRODUCT_MEDIA_REMOVED` (entity type `PRODUCT_MEDIA`), `PRODUCT_MEDIA_REORDERED` (entity type `PRODUCT`).

### Errors
| Case | Response |
|---|---|
| Invalid body; type not JPEG/PNG/WebP; file name extension not matching (`file_extension_mismatch`); `sizeBytes` over 5 MB | `400 VALIDATION_ERROR` |
| Upload without the purpose's permission | `403 PERMISSION_DENIED` |
| Upload bytes without a valid token, or after completion | `403 FORBIDDEN` |
| Upload bytes with another `Content-Type` | `400 VALIDATION_ERROR`, issue code `content_type_mismatch` |
| More bytes than `sizeBytes`, or none | `400 VALIDATION_ERROR`, issue `file` / `file_too_large` / `file_empty` |
| Upload authorization expired | `409 CONFLICT`, `details.reason = UPLOAD_EXPIRED` |
| Upload bytes that arrive after the upload was completed meanwhile | `409 CONFLICT`, `details.reason = UPLOAD_CLOSED` |
| Completing before any bytes arrived | `409 CONFLICT`, `details.reason = UPLOAD_NOT_RECEIVED` |
| Completing a refused file | `409 CONFLICT`, `details.reason = UPLOAD_REJECTED` (+ `rejectionReason`) |
| The file fails a check on completion | `400 VALIDATION_ERROR`, issue `file` with code `file_type_not_allowed`, `file_type_mismatch`, `file_corrupt`, `file_trailing_data`, `image_animated`, `image_too_small`, `image_too_large`, `file_too_large`, `file_empty` or `file_content_suspicious` |
| Too many uploads started | `429 RATE_LIMITED` (+ `retryAfterSeconds`) |
| Unknown upload, or one started by another employee (`/files/complete`); unknown, pending, refused or not-allowed file (`/content`) | `404 NOT_FOUND` (`401` without a session for files that are not public) |
| Attaching an unknown file or one of another purpose | `400 VALIDATION_ERROR`, issue code `media_asset_not_found` |
| Attaching a file that is not `SAFE` | `409 CONFLICT`, `details.reason = MEDIA_NOT_READY` (+ `scanStatus`) |
| Attaching a file already on the product | `409 CONFLICT`, `details.reason = MEDIA_ALREADY_ATTACHED` |
| `variantId` not of this product / archived | `400 VALIDATION_ERROR` `variant_not_found` / `409 CONFLICT` `VARIANT_ARCHIVED` |
| More images than the limit | `409 CONFLICT`, `details.reason = IMAGE_LIMIT` (+ `limit`) |
| Removing the last image of a `PUBLISHED` product | `409 CONFLICT`, `details.reason = MAIN_IMAGE_REQUIRED` |
| Changing images of an `ARCHIVED` product | `409 CONFLICT`, `details.reason = PRODUCT_ARCHIVED` |
| `mediaIds` not exactly the current images | `400 VALIDATION_ERROR`, issue code `media_order_mismatch` |
| Unknown or malformed product or image id, or a removed image | `404 NOT_FOUND` |

## TASK-017 Amendments (product lifecycle)

Added by TASK-017 (`docs/tasks/TASK-017-product-publishing.md`). Business rules: Q22, Q23, Q75, Q178, R18, R19, User Flows §4.1. Technical design and the product owner's decisions of 2026-10-02: ADR-0022. Same employee session and `Origin` rules as TASK-014. No approval requests (R19).

### Endpoints (§13)
| Endpoint | Permission | From status | To status |
|---|---|---|---|
| `POST /admin/products/{id}/publish` | `PRODUCT_PUBLISH` | `DRAFT`, `DISABLED` | `PUBLISHED` |
| `POST /admin/products/{id}/unpublish` | `PRODUCT_PUBLISH` | `PUBLISHED`, `DISABLED` | `DRAFT` |
| `POST /admin/products/{id}/disable` | `PRODUCT_ARCHIVE` | `PUBLISHED` | `DISABLED` |
| `POST /admin/products/{id}/archive` | `PRODUCT_ARCHIVE` | `DRAFT`, `PUBLISHED`, `DISABLED` | `ARCHIVED` (final) |

- Request body optional: `{ reason? }` (max 1000 characters; blank means none), kept in the audit entry. Success: `200` `product`.
- Repeating a transition (e.g. publishing a published product) returns `200` with the product unchanged and writes no audit entry.
- Publishing needs a current main image (Q178) and, when the product has more than one active variant, Arabic and English names on every active variant. TASK-018 adds a selling price.
- `DISABLED` is a pause: hidden and not purchasable, still editable, can be published again. `ARCHIVED` is final: read-only, kept for history.
- While a product is `PUBLISHED`, its last image cannot be removed (TASK-016) and variant changes may not leave several active variants with an unnamed one.
- The slug can change only while the product is a `DRAFT` that was never published (refines TASK-014 `SLUG_LOCKED`).
- `product` gains `firstPublishedAt` (set by the first publish, never cleared).
- `GET /files/{id}/content` is public for current images of `PUBLISHED` **and `ARCHIVED`** products (wishlists, order history); `DRAFT` and `DISABLED` products' images need a staff session.
- Audit actions added: `PRODUCT_PUBLISHED`, `PRODUCT_UNPUBLISHED`, `PRODUCT_DISABLED`, `PRODUCT_ARCHIVED` (entity type `PRODUCT`; previous and new `status`, `reason`).

### Errors
| Case | Response |
|---|---|
| Invalid body (`reason` too long, malformed JSON) | `400 VALIDATION_ERROR` |
| Any transition of an `ARCHIVED` product | `409 CONFLICT`, `details.reason = PRODUCT_ARCHIVED` |
| Transition not allowed from the current status (`disable` a draft) | `409 CONFLICT`, `details.reason = PRODUCT_STATUS_INVALID` (+ `status`) |
| Publishing a product that misses a requirement | `409 CONFLICT`, `details.reason = PUBLISH_REQUIREMENTS_NOT_MET`, `details.missing` (`MAIN_IMAGE`, `VARIANT_NAMES`), `details.unnamedVariantIds` |
| Adding a variant or clearing a variant name of a `PUBLISHED` product so that several active variants include an unnamed one | `409 CONFLICT`, `details.reason = VARIANT_NAMES_REQUIRED` (+ `unnamedVariantIds`, existing variants only) |
| Changing the slug of a product that is not a never-published `DRAFT` | `409 CONFLICT`, `details.reason = SLUG_LOCKED` |
| Unknown or malformed product id | `404 NOT_FOUND` |

## TASK-018 Amendments (prices and costs)

Added by TASK-018 (`docs/tasks/TASK-018-pricing-cost.md`). Business rules: Q73, Q74, Q80, Q102, Q103, Q111, C1, R9. Technical design and the product owner's decisions of 2026-10-02: ADR-0023. Same employee session and `Origin` rules as TASK-014. No approval requests (R19). Money is integer piastres (§2 principle 3); margins are integer basis points (1 bp = 0.01%).

### Variant fields (§13)
- Every admin `variant` (in `product.variants` and the variant endpoints) gains `sellingPrice` (integer or `null` until set; tax-inclusive) and `currency` (`EGP`).
- Callers with `VIEW_COST_PRICE` also get `costs`: `{ latestPurchaseCost, weightedAverageCost, marginBasisPoints, costsEditable }` (margin of the selling price over the latest purchase cost; `costsEditable` is `false` once a goods receipt has set the costs). Without it the `costs` key is absent.
- `POST /admin/products` (`defaultVariant.sellingPrice`) and `POST /admin/products/{id}/variants` (`sellingPrice`) accept an optional positive price; giving one also needs `EDIT_PRODUCT_PRICE`.

### `POST /admin/products/{id}/price-review` — `EDIT_PRODUCT_PRICE`
Request:
```json
{
  "items": [
    { "variantId": "…", "sellingPrice": 19999 },
    { "variantId": "…", "targetMarginBasisPoints": 4000 }
  ],
  "apply": false,
  "reason": "Spring prices"
}
```
- Each item has exactly one of `sellingPrice` (positive integer) or `targetMarginBasisPoints` (0–9999). 1–100 items, each variant once, all active variants of this product. `apply` defaults to `false` (preview only). `reason` optional (max 1000, blank means none).
- A target margin suggests `latestPurchaseCost / (1 − margin)`, rounded HALF-UP to the piastre, and needs `VIEW_COST_PRICE`.
- Success `200`:
```json
{
  "applied": true,
  "minimumMarginBasisPoints": 1000,
  "items": [
    {
      "variantId": "…", "sku": "LIP-RED", "currentPrice": null, "proposedPrice": 19999, "changes": true,
      "latestPurchaseCost": 12000, "marginBasisPoints": 4000, "warnings": []
    }
  ]
}
```
- `minimumMarginBasisPoints`, `latestPurchaseCost`, `marginBasisPoints` and `warnings` are present only for callers with `VIEW_COST_PRICE`. `warnings`: `PRICE_NOT_ABOVE_COST`, `BELOW_MINIMUM_MARGIN`; they never block.
- With `apply: true` the changed prices are saved at once; unchanged ones are skipped. Audit action `PRODUCT_VARIANT_PRICE_CHANGED` (entity `PRODUCT_VARIANT`; previous and new `sellingPrice`, `targetMarginBasisPoints` when used, `reason`).

### `PATCH /admin/variants/{id}/cost` — `EDIT_COST_PRICE`
- Request: `{ latestPurchaseCost?, weightedAverageCost?, reason }` (integers ≥ 0, at least one; `reason` required, max 1000). Opening values only: refused once a goods receipt has set the costs.
- Success `200` `variant` (with `costs` for callers with `VIEW_COST_PRICE`). Repeating the same values writes no audit entry. Audit action `PRODUCT_VARIANT_COST_CHANGED` (previous and new costs, `reason`).

### Publishing (amends "TASK-017 Amendments")
- Publishing also needs a selling price on every active variant: `details.missing` may contain `SELLING_PRICE`, with `details.unpricedVariantIds`.
- A variant added to a `PUBLISHED` product needs a `sellingPrice`.

### Errors
| Case | Response |
|---|---|
| Invalid body (both or neither of price and margin, price ≤ 0 or fractional, margin out of range, duplicate variant, missing cost `reason`) | `400 VALIDATION_ERROR` |
| A variant that is not this product's | `400 VALIDATION_ERROR`, issue code `variant_not_found` |
| Missing `EDIT_PRODUCT_PRICE` / `EDIT_COST_PRICE`; a target margin or a price at creation without the needed permission | `403 PERMISSION_DENIED` (+ `requiredPermissions`) |
| Archived product or variant | `409 CONFLICT`, `details.reason = PRODUCT_ARCHIVED` / `VARIANT_ARCHIVED` |
| Target margin without a latest purchase cost | `409 CONFLICT`, `details.reason = COST_UNKNOWN` (+ `variantId`) |
| Target margin over a zero cost | `409 CONFLICT`, `details.reason = PRICE_SUGGESTION_UNAVAILABLE` (+ `variantId`) |
| Costs typed by hand after a goods receipt | `409 CONFLICT`, `details.reason = COSTS_LOCKED` |
| New variant of a `PUBLISHED` product without a price | `409 CONFLICT`, `details.reason = SELLING_PRICE_REQUIRED` |
| Unknown or malformed product / variant id | `404 NOT_FOUND` |

## TASK-019 Amendments (inventory ledger and balances)

Added by TASK-019 (`docs/tasks/TASK-019-inventory-ledger.md`). Business rules: Q21, Q71, Q72, Q108, Q109, Q110. Technical design and the product owner's decisions of 2026-10-02: ADR-0024. Same employee session and `Origin` rules as TASK-014. No approval requests.

### Inventory item
`GET /admin/inventory`, `GET /admin/inventory/low-stock` (lists, paginated with `page`/`pageSize`) and `GET /admin/inventory/{variantId}` return:
```json
{
  "variantId": "…", "sku": "LIP-RED", "variantNameAr": null, "variantNameEn": null, "variantStatus": "ACTIVE",
  "product": { "id": "…", "nameAr": "…", "nameEn": "Matte Lipstick", "status": "PUBLISHED" },
  "availableQuantity": 12, "reservedQuantity": 2, "damagedQuantity": 1,
  "lowStockThreshold": 5, "lowStock": false, "updatedAt": "…"
}
```
- `lowStockThreshold` is the variant's own threshold, else the product's, else `null`. `lowStock` is `availableQuantity <= lowStockThreshold`, only for active variants of non-archived products.
- `GET /admin/inventory`: every variant, archived included, ordered by SKU; optional `search` (SKU or either product name).
- `GET /admin/inventory/low-stock`: variants with `lowStock`, lowest `availableQuantity` first.

### `GET /admin/inventory/{variantId}/movements` — `INVENTORY_VIEW`
Paginated, newest first: `{ id, variantId, type, availableDelta, reservedDelta, damagedDelta, referenceType, referenceId, reason, createdBy: { type, id }, createdAt }`.

### `POST /admin/inventory/{variantId}/adjust` — `ADJUST_INVENTORY`
- Request: `{ type, quantity, reason }`. `type` `MANUAL_ADJUSTMENT` takes a signed quantity (Available ±); `DAMAGE` (Available → Damaged) and `DAMAGE_WRITE_OFF` (Damaged out) take a positive one. Integer, non-zero, at most 1,000,000 either way. `reason` required, max 1000.
- Success `200`: `{ inventory, movement }` (the item and the new movement above). Audit action `INVENTORY_ADJUSTED` (entity `PRODUCT_VARIANT`; previous and new quantities, movement id, type, quantity, `reason`).
- Archived variants and products may be adjusted.

### Thresholds (§13)
- `PATCH /admin/products/{id}` and `PATCH /admin/variants/{id}` (`PRODUCT_EDIT`) accept `lowStockThreshold` (integer 0–1,000,000, or `null` to remove it); `product` and `variant` responses include it.

### Errors
| Case | Response |
|---|---|
| Invalid body or query (zero/fractional/out-of-range quantity, negative quantity for `DAMAGE`/`DAMAGE_WRITE_OFF`, missing reason, unknown type, bad threshold) | `400 VALIDATION_ERROR` |
| Missing `INVENTORY_VIEW` / `ADJUST_INVENTORY` | `403 PERMISSION_DENIED` (+ `requiredPermissions`) |
| The adjustment would take Available or Damaged below zero | `409 CONFLICT`, `details.reason = INSUFFICIENT_STOCK` (+ `quantity`: `available`/`damaged`, `onHand`) |
| Unknown or malformed variant id | `404 NOT_FOUND` |

## TASK-020 Amendments (inventory reservations)

Added by TASK-020 (`docs/tasks/TASK-020-inventory-reservations.md`, ADR-0025). No new endpoints: checkout, COD expiry, cancellation and shipping use the reservation engine inside their own transactions.

- When any line of an order cannot be reserved, the whole request fails with `409 STOCK_CHANGED` and `details.items = [{ variantId }]`, the short variants only. Available quantities are not exposed (§13 public responses).
- Admin inventory responses (§22) show held stock in `reservedQuantity`; movement history shows `RESERVATION`, `RELEASE_RESERVATION` and `CUSTOMER_ORDER_COMMIT` movements with `referenceType = "ORDER"`.

## TASK-021 Amendments (suppliers)

Added by TASK-021 (`docs/tasks/TASK-021-suppliers.md`, ADR-0026). Same employee session and `Origin` rules as the other admin endpoints. No approval requests.

### Endpoints (§21)
| Endpoint | Permission | Request | Success |
|---|---|---|---|
| `GET /admin/suppliers` | `SUPPLIER_VIEW` | query `page`, `pageSize` (max 100), `status`, `search` (name, phone or email) | `200` `[supplier]` by name + `meta.pagination` |
| `POST /admin/suppliers` | `SUPPLIER_MANAGE` | `{ name, phone?, email?, address?, notes? }` | `201` `supplier` (status `ACTIVE`) |
| `PATCH /admin/suppliers/{id}` | `SUPPLIER_MANAGE` | any of `{ name, phone, email, address, notes, status }`; `null` clears an optional field | `200` `supplier` |

- `supplier`: `{ id, name, phone, email, address, notes, status, createdAt, updatedAt }`. `status`: `ACTIVE` or `INACTIVE` (deactivate / reactivate). Nothing is deleted.
- `phone`: digits with an optional leading `+`, spaces, hyphens and brackets allowed. `email` is returned lowercase.
- Audit actions added: `SUPPLIER_CREATED`, `SUPPLIER_UPDATED` (entity type `SUPPLIER`).

### Errors
| Case | Response |
|---|---|
| Invalid body or query | `400 VALIDATION_ERROR` |
| Name used by another supplier (any case) | `409 CONFLICT`, `details.reason = NAME_TAKEN` |
| Unknown or malformed supplier id | `404 NOT_FOUND` |

## TASK-022 Amendments (purchase orders)

Added by TASK-022 (`docs/tasks/TASK-022-purchase-orders.md`, ADR-0027). Business rules: Q101, Q102, Q112, Q113, User Flows §14. Same employee session and `Origin` rules as the other admin endpoints. Adds `GET` and `PATCH /admin/purchases/{id}` and `POST /admin/purchases/{id}/reject` to §21.

### Endpoints (§21)
| Endpoint | Permission | Request | Success |
|---|---|---|---|
| `GET /admin/purchases` | `PURCHASE_VIEW` | query `page`, `pageSize` (max 100), `status`, `supplierId`, `search` (purchase number) | `200` `[purchaseSummary]` newest first + `meta.pagination` |
| `GET /admin/purchases/{id}` | `PURCHASE_VIEW` | — | `200` `purchase` |
| `POST /admin/purchases` | `PURCHASE_CREATE` | `{ supplierId, notes?, items: [{ variantId, quantity, unitCost }] }` | `201` `purchase` (status `DRAFT`) |
| `PATCH /admin/purchases/{id}` | `PURCHASE_CREATE` | any of `{ supplierId, notes, items }`; `items` replaces every line; `notes: null` clears | `200` `purchase` |
| `POST /admin/purchases/{id}/submit` | `PURCHASE_CREATE` | optional `{ reason? }` | `200` `purchase`: `PENDING_APPROVAL` with a `PURCHASE_ORDER` approval request, or `APPROVED` when the submitter holds `PURCHASE_APPROVE` (Owner/Admin) |
| `POST /admin/purchases/{id}/approve` | `PURCHASE_APPROVE` | optional `{ reason? }` | `200` `purchase` (`APPROVED`) |
| `POST /admin/purchases/{id}/reject` | `PURCHASE_APPROVE` | `{ reason }` (required) | `200` `purchase` (back to `DRAFT`) |
| `POST /admin/purchases/{id}/send` | `PURCHASE_CREATE` | — | `200` `purchase` (`SENT`). Records that staff sent the order; the system sends nothing. |
| `POST /admin/purchases/{id}/cancel` | `PURCHASE_CREATE`; `PURCHASE_APPROVE` when `APPROVED` or `SENT` | `{ reason }` (required) | `200` `purchase` (`CANCELLED`); a pending approval request is cancelled |

- `purchaseSummary`: `{ id, purchaseNumber, status, supplier: { id, name }, orderedTotal, currency, notes, createdBy, submittedAt, approvedBy, approvedAt, sentAt, cancelledBy, cancelledAt, cancellationReason, createdAt, updatedAt }`; people are `{ id, displayName }` or null.
- `purchase`: `purchaseSummary` + `items: [{ id, variantId, sku, productNameAr, productNameEn, variantNameAr, variantNameEn, orderedQuantity, unitCost, lineTotal }]` + `approval: { id, status, resolutionReason, resolvedAt } | null` (the latest approval request, so the creator sees why it was rejected).
- Money (`unitCost`, `lineTotal`, `orderedTotal`) is integer piastres. `quantity` 1–100000, `unitCost` 1–100000000, 1–200 lines, each variant once. The server computes the totals.
- `PURCHASE_ORDER` requests can also be resolved through `/admin/approval-requests/{id}/approve|reject` (TASK-013 Amendments) with the same outcome. Nobody resolves their own request.
- Audit actions added (entity type `PURCHASE_ORDER`): `PURCHASE_ORDER_CREATED`, `PURCHASE_ORDER_UPDATED`, `PURCHASE_ORDER_SUBMITTED`, `PURCHASE_ORDER_APPROVED`, `PURCHASE_ORDER_REJECTED`, `PURCHASE_ORDER_SENT`, `PURCHASE_ORDER_CANCELLED`.

### Errors
| Case | Response |
|---|---|
| Invalid body or query; unknown `supplierId` or `variantId` | `400 VALIDATION_ERROR` |
| Supplier inactive (create, supplier change, submit) | `409 CONFLICT`, `details.reason = SUPPLIER_INACTIVE` |
| Variant or its product archived | `409 CONFLICT`, `details.reason = VARIANT_ARCHIVED` |
| Action not allowed in the current status (edit outside `DRAFT`, approve when not pending, …) | `409 CONFLICT`, `details.reason = PURCHASE_STATUS_INVALID`, `details.status` |
| Cancelling an `APPROVED`/`SENT` order without `PURCHASE_APPROVE` | `403 PERMISSION_DENIED`, `details.reason = PURCHASE_APPROVE_REQUIRED` |
| Unknown or malformed purchase order id | `404 NOT_FOUND` |

## TASK-023 Amendments

Added by TASK-023 (`docs/tasks/TASK-023-goods-receiving.md`, ADR-0028). Business rules: Q101–Q104, Q114–Q117, User Flows §14. Same employee session and `Origin` rules as the other admin endpoints. Completes `/admin/purchases/{id}/receive` (§21) and `/admin/purchases/{id}/invoice` (v1.1 "Supplier finance"), and adds `POST /admin/purchases/{id}/close`.

| Endpoint | Permission | Request | Success |
|---|---|---|---|
| `POST /admin/purchases/{id}/receive` | `RECEIVE_PURCHASE` | Header `Idempotency-Key` (required, 8–200 of `A-Z a-z 0-9 . _ : -`). `{ notes?, items: [{ purchaseItemId, deliveredQuantity, damagedQuantity?, notes? }] }` | `201` `{ receipt, purchase, costReview? }` |
| `POST /admin/purchases/{id}/invoice` | `SUPPLIER_PAYMENT_MANAGE` | `{ invoiceNumber, invoiceDate, invoiceTotal, taxAmount?, mediaAssetId, notes? }` | `201` `purchase` |
| `POST /admin/purchases/{id}/close` | `PURCHASE_CREATE` | `{ reason }` (required) | `200` `purchase` (`CLOSED`) |

- **Receive**: allowed when the order is `APPROVED`, `SENT` or `PARTIALLY_RECEIVED`. Per line, `deliveredQuantity` 1–100000 and `damagedQuantity` 0–100000 (default 0), 1–200 lines, each purchase line once. Units up to what is still due are received: damaged ones into Damaged, the rest into Available. Good units beyond that are extras: they open one `PURCHASE_OVER_DELIVERY` approval request for the receipt (entity type `GOODS_RECEIPT`), resolved through `/admin/approval-requests/{id}/approve|reject`. When the receiver holds `PURCHASE_APPROVE` (Owner/Admin), the extras are accepted at once. A line's `notes` is required when the line is short, has damaged units or has extras. The order becomes `RECEIVED` once every line is fully received (accepted + damaged), otherwise `PARTIALLY_RECEIVED`. A retry with the same key and body returns the same receipt.
- **Costs**: accepted units set the variant's latest purchase cost and weighted average cost (Q103), and lock hand-typed costs (`COSTS_LOCKED`, TASK-018). Callers with `VIEW_COST_PRICE` get `costReview: [{ variantId, previousLatestPurchaseCost, latestPurchaseCost, weightedAverageCost, sellingPrice, marginBasisPoints, marginReduced, warnings }]` (Q102); prices never change on their own.
- **Invoice**: allowed when the order is `APPROVED`, `SENT`, `PARTIALLY_RECEIVED` or `RECEIVED`. `invoiceDate` `YYYY-MM-DD`; `invoiceTotal` 1–10^12 and `taxAmount` 0–`invoiceTotal` in piastres, as on the invoice. `mediaAssetId` is a `SAFE` upload of purpose `SUPPLIER_INVOICE` (§28: `POST /files/upload-init` with `purpose: "SUPPLIER_INVOICE"` needs `SUPPLIER_PAYMENT_MANAGE`; JPEG/PNG/WebP). Recorded invoices never change.
- **Close**: allowed from `PARTIALLY_RECEIVED` or `RECEIVED`, once at least one invoice is recorded and no extras await approval.
- **Reading orders**: `GET /admin/purchases` and `GET /admin/purchases/{id}` also accept `RECEIVE_PURCHASE`. Without `PURCHASE_VIEW`, `orderedTotal`, `unitCost` and `lineTotal` are absent.
- `purchaseSummary` adds `closedBy`, `closedAt`, `closingReason`.
- `purchase` adds:
  - per item: `receivedQuantity` (accepted + damaged), `acceptedQuantity`, `damagedQuantity`, `extraAcceptedQuantity` and `remainingQuantity`;
  - `receipts: [receipt]`;
  - for callers with `SUPPLIER_FINANCE_VIEW` or `SUPPLIER_PAYMENT_MANAGE` only, `invoices: [{ id, invoiceNumber, invoiceDate, invoiceTotal, taxAmount, file: { mediaAssetId, url }, notes, recordedBy, createdAt }]`.
- `receipt`: `{ id, receiptNumber, receivedBy, receivedAt, notes, items: [{ purchaseItemId, variantId, sku, deliveredQuantity, acceptedQuantity, damagedQuantity, overDeliveryQuantity, inspectionNotes }], overDelivery: { approvalRequestId, status } | null }`.
- Invoice files are served by `GET /files/{id}/content` to staff with `SUPPLIER_FINANCE_VIEW` or `SUPPLIER_PAYMENT_MANAGE`.
- Audit actions added (entity type `PURCHASE_ORDER`): `GOODS_RECEIPT_RECORDED`, `PURCHASE_OVER_DELIVERY_ACCEPTED`, `PURCHASE_OVER_DELIVERY_REJECTED`, `PURCHASE_INVOICE_RECORDED`, `PURCHASE_ORDER_CLOSED`.

### Errors
| Case | Response |
|---|---|
| Missing or malformed `Idempotency-Key` | `400 VALIDATION_ERROR`, issue code `idempotency_key_required` / `idempotency_key_invalid` |
| Same `Idempotency-Key` with a different request | `409 IDEMPOTENCY_CONFLICT` |
| Purchase line not on the order | `400 VALIDATION_ERROR`, issue code `purchase_item_not_found` |
| Damaged units more than delivered, or more than still due | `400 VALIDATION_ERROR`, issue code `damaged_exceeds_delivered` / `damaged_exceeds_due` |
| Line differs from what was due without `notes` | `400 VALIDATION_ERROR`, issue code `notes_required` |
| Invoice file unknown or of another purpose | `400 VALIDATION_ERROR`, issue code `media_asset_not_found` |
| Invoice file not yet checked | `409 CONFLICT`, `details.reason = MEDIA_NOT_READY` |
| Invoice number already recorded on the order | `409 CONFLICT`, `details.reason = INVOICE_NUMBER_TAKEN` |
| Invoice file already attached | `409 CONFLICT`, `details.reason = MEDIA_ALREADY_ATTACHED` |
| Closing without an invoice | `409 CONFLICT`, `details.reason = INVOICE_REQUIRED` |
| Closing while extras await approval | `409 CONFLICT`, `details.reason = OVER_DELIVERY_PENDING` |
| Action not allowed in the current status (receiving a draft or closed order, cancelling a partly received one, …) | `409 CONFLICT`, `details.reason = PURCHASE_STATUS_INVALID`, `details.status` |

## TASK-024 Amendments

Added by TASK-024 (`docs/tasks/TASK-024-supplier-returns-ledger.md`, ADR-0029). Business rules: Q105–Q107, Q118–Q120, Audit Correction 6, User Flows §14.4. Same employee session and `Origin` rules as the other admin endpoints. Completes `/admin/purchases/{id}/supplier-return`, `/admin/supplier-returns/{id}/submit|settle` (§21) and the v1.1 "Supplier finance" endpoints; adds `GET /admin/supplier-returns` and `GET /admin/supplier-returns/{id}`.

| Endpoint | Permission | Request | Success |
|---|---|---|---|
| `POST /admin/purchases/{id}/supplier-return` | `SUPPLIER_RETURN_MANAGE` | `{ reason, items: [{ goodsReceiptItemId, quantity, reason? }] }` | `201` `supplierReturn` (`DRAFT`) |
| `POST /admin/supplier-returns/{id}/submit` | `SUPPLIER_RETURN_MANAGE` | `{ reason? }` (body optional) | `200` `supplierReturn` |
| `POST /admin/supplier-returns/{id}/settle` | `SUPPLIER_PAYMENT_MANAGE` | `{ resolution: "REFUND" \| "CREDIT" \| "OTHER", amount?, notes? }` | `200` `supplierReturn` (`SETTLED`) |
| `GET /admin/supplier-returns` | any of `SUPPLIER_RETURN_MANAGE`, `SUPPLIER_FINANCE_VIEW`, `SUPPLIER_PAYMENT_MANAGE` | Query `page`, `pageSize`, `status?`, `supplierId?`, `purchaseId?` | `200` `[supplierReturn]`, newest first, with `pagination` |
| `GET /admin/supplier-returns/{id}` | as above | — | `200` `supplierReturn` |
| `POST /admin/suppliers/{id}/payments` | `SUPPLIER_PAYMENT_MANAGE` | Header `Idempotency-Key` (required). `{ amount, method: "CASH" \| "BANK_TRANSFER" \| "CHEQUE" \| "OTHER", paidOn, purchaseId?, reference?, notes? }` | `201` `{ payment, balance }` |
| `GET /admin/suppliers/{id}/ledger` | `SUPPLIER_FINANCE_VIEW` | Query `page`, `pageSize` | `200` `[ledgerEntry]`, newest first, with `pagination` |
| `GET /admin/suppliers/{id}/balance` | `SUPPLIER_FINANCE_VIEW` | — | `200` `balance` |

- **Create**: each line returns `quantity` (1–100000) damaged units of a goods receipt line of this order; 1–200 lines, each receipt line once. A line can return at most its damaged units minus those on other pending, approved or settled returns (drafts and rejected returns hold nothing). The expected amount is Σ `quantity` × the purchase line's unit cost (Q120).
- **Submit**: `DRAFT` → `PENDING_APPROVAL` and a `SUPPLIER_RETURN` approval request (entity type `SUPPLIER_RETURN`), resolved through `/admin/approval-requests/{id}/approve|reject` (Q105). A submitter holding `PURCHASE_APPROVE` (Owner/Admin) approves at once. Approval → `APPROVED`: the units leave Damaged stock (`SUPPLIER_RETURN` inventory movement per line, with its unit cost). Rejection → `REJECTED` (final); the units can go on a new return.
- **Settle**: from `APPROVED`. `amount` (piastres, 1–10^12) defaults to the expected amount and is not allowed for `OTHER`. `notes` is required for `OTHER` and when `amount` differs from the expected amount. Ledger: `CREDIT` writes a `CREDIT` entry (lowers what we owe); `REFUND` writes a `CREDIT` entry and a `REFUND` entry (cash received), so the balance nets to zero; `OTHER` writes none (`financialAmount` 0).
- `supplierReturn`: `{ id, returnNumber, status, supplier: { id, name }, purchase: { id, purchaseNumber }, reason, expectedAmount, financialResolution, financialAmount, settlementNotes, items: [{ id, goodsReceiptItemId, receiptNumber, purchaseItemId, variantId, sku, quantity, unitCost, lineTotal, reason }], createdBy, createdAt, submittedAt, approvedBy, approvedAt, settledBy, settledAt, updatedAt, approval: { id, status, resolutionReason } | null }`.
- **Payments**: any positive amount (1–10^12 piastres); partial payments and payments beyond what is owed are allowed (the balance goes negative). `paidOn` `YYYY-MM-DD`. `purchaseId`, when given, must be an order of this supplier in `APPROVED`, `SENT`, `PARTIALLY_RECEIVED`, `RECEIVED` or `CLOSED`. A retry with the same key and body returns the same payment; payments are never changed. `payment`: `{ id, supplierId, purchase: { id, purchaseNumber } | null, amount, method, paidOn, reference, notes, recordedBy, createdAt }`.
- **Invoices** (`POST /admin/purchases/{id}/invoice`, TASK-023) now also add an `INVOICE` ledger entry for the invoice total.
- `ledgerEntry`: `{ id, entryType: "INVOICE" | "PAYMENT" | "CREDIT" | "REFUND", direction: "CREDIT" | "DEBIT", amount, signedAmount, purchase: { id, purchaseNumber } | null, supplierReturn: { id, returnNumber } | null, purchaseInvoiceId, supplierPaymentId, reference, createdBy, createdAt }`. `signedAmount` is + when it raises what we owe.
- `balance`: `{ supplierId, currency, balance, totals: { invoiced, paid, credited, refunded }, purchases: [{ id, purchaseNumber, invoiced, paid, balance, paymentStatus: "PAID" | "PARTIALLY_PAID" | "UNPAID" }] }`. `balance` is what we owe (negative: the supplier owes us). `purchases` lists invoiced orders (Q118): nothing left to pay is `PAID`, otherwise any payment on the order makes it `PARTIALLY_PAID`.
- Audit actions added: `SUPPLIER_RETURN_CREATED`, `SUPPLIER_RETURN_SUBMITTED`, `SUPPLIER_RETURN_APPROVED`, `SUPPLIER_RETURN_REJECTED`, `SUPPLIER_RETURN_SETTLED` (entity type `SUPPLIER_RETURN`), `SUPPLIER_PAYMENT_RECORDED` (entity type `SUPPLIER`).

### Errors
| Case | Response |
|---|---|
| Missing or malformed `Idempotency-Key` on a payment | `400 VALIDATION_ERROR`, issue code `idempotency_key_required` / `idempotency_key_invalid` |
| Same `Idempotency-Key` with a different payment | `409 IDEMPOTENCY_CONFLICT` |
| Goods receipt line not on the order | `400 VALIDATION_ERROR`, issue code `goods_receipt_item_not_found` |
| More units than can still be returned (create) | `400 VALIDATION_ERROR`, issue code `quantity_exceeds_returnable` |
| Units taken by another return since the draft (submit, approve) | `409 CONFLICT`, `details.reason = RETURN_QUANTITY_EXCEEDED` |
| Damaged stock lower than the units to return (e.g. written off) | `409 CONFLICT`, `details.reason = DAMAGED_STOCK_INSUFFICIENT` |
| `amount` with `OTHER` | `400 VALIDATION_ERROR`, issue code `amount_not_allowed` |
| Settlement differs from the expected amount, or `OTHER`, without `notes` | `400 VALIDATION_ERROR`, issue code `notes_required` |
| Payment order unknown or of another supplier | `400 VALIDATION_ERROR`, issue code `purchase_not_found` |
| Payment order not yet approved or cancelled | `409 CONFLICT`, `details.reason = PURCHASE_STATUS_INVALID` |
| Return action not allowed in its status | `409 CONFLICT`, `details.reason = SUPPLIER_RETURN_STATUS_INVALID`, `details.status` |

## TASK-009 Amendments

Added by TASK-009 (`docs/tasks/TASK-009-profile-addresses.md`, ADR-0030). Business rules: Q45, Q46, Q152, Q153, Q154, R24, R27, R30, R32, R34. `/me` endpoints need an `ACTIVE` customer session (cookie requests pass the `Origin` check); admin endpoints follow the usual employee session rules. `/me/notifications` and `/me/preferences` come with TASK-045.

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /me` | Customer | — | `200` `{ account, customer }` |
| `PATCH /me` | Customer | any of `{ fullName, preferredLocale: "ar" \| "en", dateOfBirth: "YYYY-MM-DD" \| null }` | `200` `{ account, customer }` |
| `POST /me/change-email` | Customer | `{ currentPassword, newEmail }` | `202` `{ codeSent, cooldownSeconds: 60 }`; the code goes to `newEmail` |
| `POST /me/change-email/verify` | Customer | `{ code }` | `200` `{ account, customer }`; the previous email gets a notice |
| `POST /me/change-phone` | Customer | `{ currentPassword, newPhone }` | `202` `{ codeSent, cooldownSeconds: 60 }`; the code goes to the account email (R30) |
| `POST /me/change-phone/verify` | Customer | `{ code }` | `200` `{ account, customer }`; the account email gets a notice |
| `POST /me/deactivate` | Customer | `{ currentPassword }` | `204`; signs out everywhere (cookie transport: cookies cleared) and anonymizes the account at once (R34). Cannot be undone. |
| `GET /me/addresses` | Customer | — | `200` `[address]`, default first, then newest |
| `POST /me/addresses` | Customer | `{ recipientName, phone, areaId, street, label?, city?, building?, floor?, apartment?, landmark?, notes? }` | `201` `address` |
| `PATCH /me/addresses/{addressId}` | Customer | any field of create; `null` or blank clears an optional one | `200` `address` |
| `DELETE /me/addresses/{addressId}` | Customer | — | `204` |
| `POST /me/addresses/{addressId}/set-default` | Customer | — | `200` `address` |
| `GET /locations` | Public | — | `200` `[{ id, code, name, areas: [{ id, name }] }]`: active governorates in order, active areas by name, in the `Accept-Language` language |
| `GET /admin/locations` | `SHIPPING_VIEW` | — | `200` `[{ id, code, nameAr, nameEn, status, areas: [area] }]`, everything |
| `PATCH /admin/governorates/{id}` | `SHIPPING_MANAGE` | any of `{ nameAr, nameEn, status: "ACTIVE" \| "INACTIVE" }` | `200` governorate with its areas |
| `POST /admin/governorates/{id}/areas` | `SHIPPING_MANAGE` | `{ nameAr, nameEn }` | `201` `area` |
| `PATCH /admin/areas/{id}` | `SHIPPING_MANAGE` | any of `{ nameAr, nameEn, status }` | `200` `area` |

- `customer` (here and in the auth responses) gains `dateOfBirth` (`YYYY-MM-DD` or `null`).
- Email and phone change: the current password is checked first (wrong passwords count toward the R24 lock); codes follow the TASK-008 rules (6 digits, 5 minutes, 5 attempts, 60 s cooldown, 5 per hour per purpose and email, 20 sends per IP per hour). Only the newest code of each kind works. `codeSent: false` means the email could not be sent; request again after the cooldown. Sessions are kept.
- `address`: `{ id, label, recipientName, phone, governorate: { id, code, name, active }, area: { id, name, active }, city, street, building, floor, apartment, landmark, notes, isDefault, createdAt, updatedAt }`. `phone` is an Egyptian mobile (R27), returned in E.164. Up to 20 addresses; the first becomes the default; deleting the default makes the most recently updated remaining address the default. An address keeps its area if the area is deactivated later (`area.active: false`); a new area must be active.
- Admin `area`: `{ id, governorateId, nameAr, nameEn, status }`. Area names are unique within their governorate, per language. Governorates are fixed (27, ISO 3166-2:EG codes); nothing is deleted.
- Deactivation (R34) wipes the name, email, phone, date of birth, saved addresses and codes; orders, returns, audit and financial records keep their snapshots. The email and phone can register again as a new account. It is refused while an order, return or wallet balance is open (checks added by TASK-028/030/037).
- Audit actions added: `CUSTOMER_EMAIL_CHANGED`, `CUSTOMER_PHONE_CHANGED`, `CUSTOMER_DEACTIVATED` (actor `CUSTOMER`, entity `CUSTOMER`; deactivation stores no personal data), `GOVERNORATE_UPDATED` (entity `GOVERNORATE`), `AREA_CREATED`, `AREA_UPDATED` (entity `AREA`).

### Errors
| Case | Response |
|---|---|
| Wrong current password | `401 AUTH_INVALID_CREDENTIALS` |
| Account locked (R24) or code limits reached | `429 AUTH_RATE_LIMITED`, `details.retryAfterSeconds` |
| New email/phone equal to the current one | `400 VALIDATION_ERROR`, issue code `same_as_current` |
| Email or phone verified by another customer account (at request or verify) | `409 CONFLICT`, `details.field` = `email` / `phone` |
| Wrong or used code | `401 AUTH_OTP_INVALID`, `details.attemptsRemaining` when known |
| Expired code | `401 AUTH_OTP_EXPIRED` |
| Unknown area | `400 VALIDATION_ERROR`, issue code `area_not_found` |
| Inactive area or governorate | `400 VALIDATION_ERROR`, issue code `area_inactive` |
| 21st address | `409 CONFLICT`, `details.reason = ADDRESS_LIMIT_REACHED`, `details.limit = 20` |
| Address of another customer, unknown address/governorate/area | `404 NOT_FOUND` |
| Area name already used in the governorate | `409 CONFLICT`, `details.reason = NAME_TAKEN` |
| Deactivation while an order, return or wallet balance is open | `409 CONFLICT`, `details.reason = ACCOUNT_HAS_OPEN_ITEMS` |

## TASK-025 Amendments

Added by TASK-025 (`docs/tasks/TASK-025-cart.md`, ADR-0031). Business rules: Q37, R33; User Flows §6.1. Cart values are informational; checkout (TASK-029) revalidates everything.

**Whose cart:** a request with a customer credential (Bearer or cookie) uses the customer's cart; the credential must be valid (`401`/`403` otherwise, never a fall back to the guest cart) and cookie writes pass the `Origin` check. Without a credential, `X-Guest-Cart-Token` names the guest cart; an absent, malformed or unknown token means "no cart yet".

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /cart` | Guest/Customer | — | `200` `cart` (empty cart with `id: null` when there is none) |
| `POST /cart/items` | Guest/Customer | `{ variantId, quantity }` | `200` `cart`; adds to the line when the variant is already in the cart. The write that creates a guest cart returns `cart.guestCartToken` (only that once) |
| `PATCH /cart/items/{cartItemId}` | Guest/Customer | any of `{ quantity, variantId }` | `200` `cart`. `variantId` must be another variant of the same product; switching onto a variant already in the cart folds both lines into one |
| `DELETE /cart/items/{cartItemId}` | Guest/Customer | — | `200` `cart` |
| `POST /cart/reprice` | Guest/Customer | — | `200` `cart` + `changes: [{ cartItemId, previousUnitPrice, unitPrice }]`; accepts the current prices (Q37); discounts: see "TASK-026 Amendments" |
| `POST /cart/merge` | Customer | header `X-Guest-Cart-Token` | `200` `cart` (the customer's, after the merge) |

- `cart`: `{ id, items: [item], itemCount, subtotal, currency: "EGP", requiresReview, guestCartToken? }`. `subtotal` sums the lines that are not `UNAVAILABLE`, at current prices. `requiresReview` is true when a price changed or a line is not `AVAILABLE` (Q37).
- `item`: `{ id, productId, variantId, slug, sku, name, variantName, imageUrl, quantity, unitPrice, lastSeenUnitPrice, priceChanged, lineTotal, status, availableQuantity? }`. Money in piastres. `status`: `AVAILABLE`, `INSUFFICIENT_STOCK` (with `availableQuantity`), `UNAVAILABLE` (product no longer published, variant archived or no price: `unitPrice` and `lineTotal` are `null`). `lastSeenUnitPrice` is the price when the item was added or last repriced; `priceChanged` compares it with `unitPrice`.
- Only active variants of `PUBLISHED` products with a selling price can be added or switched to. Adding or raising a quantity above the available stock is refused; lowering a quantity always works. Lines that stop being purchasable stay in the cart.
- Merge (R33): an item in both carts gets the sum of the quantities capped at the available stock, but never less than the customer's own quantity; items in one cart only are kept as they are. When the customer has no cart, the guest cart becomes theirs. An unknown or already merged token changes nothing (safe to retry).
- Retention (R35): a guest cart unchanged for 30 days (setting `cart.guest_expiry_days`) is gone: its token behaves as unknown. Customer carts never expire; deactivating the account removes the cart.
- Limits (ADR-0031): quantity 1–999 per request, 50 different items per cart (a merge may go beyond), 30 new guest carts per IP per hour.

### Errors
| Case | Response |
|---|---|
| Unknown variant, or not purchasable (draft/disabled/archived product, archived variant, no price) | `404 NOT_FOUND` |
| Quantity above the available stock | `422 OUT_OF_STOCK`, `details.variantId`, `details.availableQuantity` |
| `variantId` of another product | `400 VALIDATION_ERROR`, issue code `other_product` |
| 51st different item | `409 CONFLICT`, `details.reason = CART_LINE_LIMIT_REACHED`, `details.limit = 50` |
| Cart item of another cart, or no cart | `404 NOT_FOUND` |
| Too many new guest carts from one IP | `429 RATE_LIMITED`, `details.retryAfterSeconds` |

## TASK-026 Amendments

Added by TASK-026 (`docs/tasks/TASK-026-discounts.md`, ADR-0032). Business rules: Q38, Q125, Q131–Q138, R9, R36.

### Admin (§23)

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /admin/discounts` | `DISCOUNT_VIEW` | query `page`, `pageSize`, `status`, `search` (code or name) | `200` `[discount]` with pagination, newest first |
| `POST /admin/discounts` | `DISCOUNT_MANAGE` | `{ nameAr, nameEn, value, scope, startsAt, code?, productIds?, categoryIds?, brandIds?, maxDiscountAmount?, minimumOrderTotal?, endsAt?, usageLimitTotal?, usageLimitPerCustomer? }` | `201` `discount` (`status: "INACTIVE"`) |
| `PATCH /admin/discounts/{id}` | `DISCOUNT_MANAGE` | any field of create; a target list replaces the current one; `null` clears an optional field | `200` `discount` |
| `POST /admin/discounts/{id}/activate` | `DISCOUNT_MANAGE` | — | `200` `discount`; again: no change |
| `POST /admin/discounts/{id}/deactivate` | `DISCOUNT_MANAGE` | — | `200` `discount`; again: no change |

- `discount`: `{ id, code, nameAr, nameEn, type: "PERCENTAGE", value, scope, productIds, categoryIds, brandIds, maxDiscountAmount, minimumOrderTotal, startsAt, endsAt, usageLimitTotal, usageLimitPerCustomer, status, usedCount, createdAt, updatedAt }`. Money in piastres; timestamps ISO-8601 with an offset.
- `value`: whole percent 1–100. `scope`: `STORE_WIDE` (no targets) or `TARGETED` (at least one product, category or brand; a category covers its subcategories). `code`: 3–32 of `A–Z 0–9 - _`, case-insensitive, unique; `null` makes the discount an offer listed in the cart. `endsAt` after `startsAt` or `null`. `usedCount`: uses not given back.
- Audit actions added: `DISCOUNT_CREATED`, `DISCOUNT_UPDATED`, `DISCOUNT_ACTIVATED`, `DISCOUNT_DEACTIVATED` (entity `DISCOUNT`).

### Cart (§14)

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `PUT /cart/discount` | Guest/Customer | `{ code }` or `{ discountId }` (a listed offer) | `200` `cart` with the discount applied |
| `DELETE /cart/discount` | Guest/Customer | — | `200` `cart` |

- `cart` gains `discount` (`{ id, code, name, percentage, amount }` or `null`), `discountProblem` (`{ discountId, code, reason }` or `null`: the chosen discount no longer applies and is not counted), `discountTotal`, `total` (`subtotal - discountTotal`, before shipping) and `availableDiscounts` (`[{ id, name, percentage, amount, maxDiscountAmount, minimumOrderTotal, endsAt }]`: codeless offers that apply now). `requiresReview` is also true while `discountProblem` is set.
- Nothing is applied automatically (Q138). The percentage applies to the targeted purchasable items; the minimum is checked against the whole subtotal; the cap limits the order's discount (R36). Rounded HALF-UP (R9).
- `POST /cart/reprice` also returns `discountRemoved` (`{ discountId, code, reason }` or `null`): a chosen discount that no longer applies is removed (Q38).
- Merge: the customer's chosen discount wins, otherwise the guest's carries over.
- `reason` values: `NOT_FOUND`, `INACTIVE`, `NOT_STARTED`, `ENDED`, `USAGE_LIMIT_REACHED`, `SIGN_IN_REQUIRED` (per-customer limit, guest), `CUSTOMER_LIMIT_REACHED`, `NO_ELIGIBLE_ITEMS`, `MINIMUM_NOT_MET`.
- Uses count from order creation and are given back when the order is cancelled or expires before shipping (R36; recorded by TASK-029, released by TASK-031/033).

### Errors
| Case | Response |
|---|---|
| Discount does not apply / unknown code / coded discount chosen by id | `422 DISCOUNT_INVALID`, `details.reason` |
| Discount has ended | `422 DISCOUNT_EXPIRED`, `details.reason = ENDED` |
| Too many unknown codes from one IP (20 per 15 minutes) | `429 RATE_LIMITED`, `details.retryAfterSeconds` |
| Store-wide with targets / targeted without | `400 VALIDATION_ERROR`, issue code `targets_not_allowed` / `targets_required` (path `scope`) |
| Unknown product, category or brand id | `400 VALIDATION_ERROR`, issue code `not_found` |
| End not after start | `400 VALIDATION_ERROR`, issue code `before_start` |
| Code used by another discount | `409 CONFLICT`, `details.reason = CODE_TAKEN` |
| Unknown discount | `404 NOT_FOUND` |

## TASK-027 Amendments

Added by TASK-027 (`docs/tasks/TASK-027-shipping-rules.md`, ADR-0033). Business rules: Q121–Q126, R37. Completes the §16 company and rule endpoints and `GET /shipping/options`; `assign-shipping` comes with the shipment tasks.

### Admin (§16)

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /admin/shipping/companies` | `SHIPPING_VIEW` | query `status` | `200` `[company]`, by name |
| `POST /admin/shipping/companies` | `SHIPPING_MANAGE` | `{ code, name, contactInfo?, status? }` | `201` `company` |
| `PATCH /admin/shipping/companies/{id}` | `SHIPPING_MANAGE` | any field of create; `contactInfo: null` clears it | `200` `company` |
| `GET /admin/shipping/rules` | `SHIPPING_VIEW` | query `page`, `pageSize`, `status`, `governorateId`, `shippingCompanyId` | `200` `[rule]` with pagination, newest first |
| `POST /admin/shipping/rules` | `SHIPPING_MANAGE` | `{ shippingFee, shippingCompanyId?, governorateId?, areaId?, minOrderTotal?, maxOrderTotal?, priority?, activeFrom?, activeTo?, status? }` | `201` `rule` |
| `PATCH /admin/shipping/rules/{id}` | `SHIPPING_MANAGE` | any field of create; `null` clears an optional field | `200` `rule` |

- `company`: `{ id, code, name, contactInfo, status, createdAt, updatedAt }`. `code`: 2–32 of `A–Z 0–9 - _`, stored uppercase, unique. `status`: `ACTIVE` (default) or `INACTIVE`; nothing is deleted.
- `rule`: `{ id, shippingCompanyId, governorateId, areaId, minOrderTotal, maxOrderTotal, shippingFee, priority, activeFrom, activeTo, status, createdAt, updatedAt }`. Money in piastres. No governorate and no area: everywhere. An area implies its governorate (filled in when omitted). `minOrderTotal` inclusive, `maxOrderTotal` exclusive; `priority` −1000…1000, default 0.
- Audit actions added: `SHIPPING_COMPANY_CREATED`, `SHIPPING_COMPANY_UPDATED` (entity `SHIPPING_COMPANY`), `SHIPPING_RULE_CREATED`, `SHIPPING_RULE_UPDATED` (entity `SHIPPING_RULE`).

### Quote (§16)

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /shipping/options` | Guest/Customer (cart as in §14) | query `areaId` | `200` `{ areaId, orderTotal, shippingFee, freeShipping, freeShippingThreshold, amountToFreeShipping, total, currency: "EGP" }` |

- `orderTotal` is the current cart `total` (after the discount, R37). The fee is the one of the most specific matching active rule (area, then governorate, then everywhere; then higher `priority`, lower fee); rules of an inactive company are skipped. From `freeShippingThreshold` on, `shippingFee` is 0. `total = orderTotal + shippingFee`.
- One fee, no carrier choice: the rule's company is only proposed for the order; staff may change it (`ASSIGN_SHIPPING`) without changing the fee (Q126, R37). Checkout (TASK-029) recomputes the same quote.

### Errors
| Case | Response |
|---|---|
| No active rule covers the area | `422 SHIPPING_UNAVAILABLE`, `details.areaId` |
| Unknown / inactive area (quote) | `400 VALIDATION_ERROR`, issue code `area_not_found` / `area_inactive` (path `areaId`) |
| Area outside the given governorate | `400 VALIDATION_ERROR`, issue code `other_governorate` (path `areaId`) |
| Unknown company, governorate or area (rule) | `400 VALIDATION_ERROR`, issue code `not_found` |
| `maxOrderTotal` not above `minOrderTotal` | `400 VALIDATION_ERROR`, issue code `below_minimum` |
| `activeTo` not after `activeFrom` | `400 VALIDATION_ERROR`, issue code `before_start` |
| Code used by another company | `409 CONFLICT`, `details.reason = CODE_TAKEN` |
| Unknown company or rule | `404 NOT_FOUND` |

## TASK-028 Amendments

Added by TASK-028 (`docs/tasks/TASK-028-wallet.md`, ADR-0034). Business rules: Q26, Q78, Q166–Q170, C4, R34. Completes §18 except `manual-refund` (returns tasks).

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /me/wallet` | Customer | — | `200` `wallet` (zeros before the first credit) |
| `GET /me/wallet/transactions` | Customer | query `page`, `pageSize` | `200` `[transaction]` with pagination, newest first; no `reason` |
| `GET /admin/customers/{customerId}/wallet` | `VIEW_WALLET_BALANCE` | — | `200` `wallet` |
| `GET /admin/customers/{customerId}/wallet/transactions` | `VIEW_WALLET_BALANCE` | query `page`, `pageSize` | `200` `[transaction]` with `reason` (added to §18 for reconciliation) |
| `POST /admin/customers/{customerId}/wallet/adjust` | `ADJUST_WALLET` (Owner/Admin only) + `Idempotency-Key` | `{ direction: "CREDIT" \| "DEBIT", amount, reason }` | `201` `{ transactionId, wallet }`; the same key and body returns the same result |

- `wallet`: `{ customerId, currency: "EGP", balance, reserved, available }` in piastres; `balance` includes credit held for pending orders (`reserved`), `available = balance − reserved`.
- `transaction`: `{ id, type, direction, amount, signedAmount, referenceType, referenceId, createdAt }` (+ `reason` for staff). `type`: `MANUAL_ADJUSTMENT`, `ORDER_WALLET_USE`, `RETURN_REFUND`.
- Adjust: `amount` 1…10^12 piastres, `reason` 1–500 characters. A debit beyond `available` is `422 WALLET_INSUFFICIENT_FUNDS` with `details.available`; a deactivated customer is `409 CONFLICT` with `details.reason = CUSTOMER_DEACTIVATED`; the same key with another body is `409 IDEMPOTENCY_CONFLICT`.
- Audit action added: `WALLET_ADJUSTED` (entity `CUSTOMER`, reason = the adjustment reason).
- R34: `POST /me/deactivate` is `409 CONFLICT` with `details = { reason: "ACCOUNT_HAS_OPEN_ITEMS", openItems: ["WALLET_BALANCE"] }` while the balance is not zero.
- Checkout (TASK-029) reserves wallet credit; `WALLET_INSUFFICIENT_FUNDS` and `WALLET_RESERVATION_CONFLICT` come from there.

## TASK-029 Amendments

Added by TASK-029 (`docs/tasks/TASK-029-checkout.md`, ADR-0035). Business rules: Q28, Q37–Q40, Q46, C4, R31, R36, R37. Completes the Checkout table of §15. Both endpoints use the cart of the caller (customer session, or `X-Guest-Cart-Token`).

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `POST /checkout/validate` | Guest/Customer | `quote` | `200` `{ items, subtotal, discount, discountTotal, shippingFee, freeShipping, freeShippingThreshold, total, walletAmount, codAmount, codConfirmationRequired, currency }` |
| `POST /checkout` | Guest/Customer + `Idempotency-Key` | `quote` + `expectedTotal` | `201` `order`; the same key and body returns the same order |

- `quote`: `{ contact?, addressId?, address?, walletAmount? }`. Exactly one of `addressId` (customers: a saved address) or `address` (`recipientName`, `phone`, `areaId`, `street`, optional `city`, `building`, `floor`, `apartment`, `landmark`, `notes`, as for `/me/addresses`). Guests must send `contact: { fullName, phone, email? }` (Egyptian mobile; email optional, R31); customers' contact is their profile. `walletAmount` piastres, default 0, customers only, at most the total.
- `expectedTotal`: the total the customer confirmed, compared with the recomputed total, never trusted.
- `order`: `{ id, orderNumber, status, currency, subtotal, discountTotal, shippingFee, total, walletAmount, codAmount, codConfirmationRequired, items: [{ variantId, sku, name, variantName, quantity, unitPrice, discountAmount, lineTotal }], createdAt }`. `status` is `PENDING_CONFIRMATION`, or `NEW` when the wallet covers the total (C4). `orderNumber` like `BF-100001`.

| Situation | Response |
|---|---|
| No cart or an empty cart | `409 CONFLICT`, `details.reason = CART_EMPTY` |
| A line unavailable or above stock (at validation or when reserving) | `409 STOCK_CHANGED`, `details.items` |
| A price changed since the shopper saw it (Q37) | `409 PRICE_CHANGED`, `details.items: [{ cartItemId, previousUnitPrice, unitPrice }]`; `POST /cart/reprice` accepts the prices |
| `expectedTotal` differs | `409 PRICE_CHANGED`, `details = { reason: "TOTAL_CHANGED", total }` |
| The chosen discount no longer applies (Q38) or its limit was reached meanwhile | `422 DISCOUNT_INVALID` / `DISCOUNT_EXPIRED` with `details.reason` |
| No shipping rule for the area (R37) | `422 SHIPPING_UNAVAILABLE` |
| Wallet credit below `walletAmount` | `422 WALLET_INSUFFICIENT_FUNDS`, `details.available` |
| Guest without `contact`; guest with `addressId` or `walletAmount`; `walletAmount` above the total; unusable area | `400 VALIDATION_ERROR`, issue codes `required`, `sign_in_required`, `above_total`, `area_not_found`/`area_inactive` |
| Another customer's `addressId` | `404 NOT_FOUND` |
| Same `Idempotency-Key`, other body | `409 IDEMPOTENCY_CONFLICT` |
| More than 20 checkout requests per IP per hour | `429 RATE_LIMITED`, `details.retryAfterSeconds` |

- Event `ORDER_CREATED` (§31) is written to the outbox in the checkout transaction: `{ orderId, orderNumber, status, codAmount }`.

## TASK-030 Amendments

Added by TASK-030 (`docs/tasks/TASK-030-order-core.md`, ADR-0036). Business rules: Q46, Q80–Q84, Q184, Q185, R1–R4, R16, R19, R34. Implements from §15 the customer order reads, the admin order reads and `confirm`, `start-preparing`, `mark-ready-for-shipment`. Still to come: `mark-shipped` (TASK-034), `record-phone-confirmation` / `confirm-cod` (TASK-031), `modify` and revisions (TASK-032), `cancel` and `request-shipping-cancellation` (TASK-033, TASK-036).

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /me/orders` | Customer | query `page`, `pageSize` | `200` `[orderListItem]` with pagination, newest first |
| `GET /orders/{orderId}` | Customer (own order) | — | `200` `customerOrder` |
| `GET /admin/orders` | `ORDERS_VIEW` | query `page`, `pageSize`, `status`, `customerId`, `search` (order number), `phone` (needs `VIEW_CUSTOMER_CONTACT`) | `200` `[orderListItem + customer]` with pagination, newest first |
| `GET /admin/orders/{orderId}` | `ORDERS_VIEW` | — | `200` `adminOrder` |
| `POST /admin/orders/{orderId}/confirm` | `CONFIRM_ORDER` | — | `200` `adminOrder`; `NEW → CONFIRMED`, sets `confirmedAt`, event `ORDER_CONFIRMED` |
| `POST /admin/orders/{orderId}/start-preparing` | `START_PREPARING` | — | `200` `adminOrder`; `CONFIRMED → PREPARING` |
| `POST /admin/orders/{orderId}/mark-ready-for-shipment` | `MARK_READY_FOR_SHIPMENT` | — | `200` `adminOrder`; `PREPARING → READY_FOR_SHIPMENT` |

- `orderListItem`: `{ id, orderNumber, status, currency, total, codAmount, itemCount, createdAt }`; the admin list adds `customer: { customerId, fullName, phone? }` (`phone` with `VIEW_CUSTOMER_CONTACT`; `customerId` null for guests).
- `customerOrder`: the checkout `order` ("TASK-029 Amendments") plus `discount: { code, name } | null`, `shippingAddress` (the address snapshot) and `statusHistory: [{ status, at }]`. Names in the request locale.
- `adminOrder`: `{ id, orderNumber, status, paymentMethod, currency, locale, subtotal, discountTotal, shippingFee, total, walletAmountReserved, walletAmountCaptured, codAmount, codConfirmationRequired, taxIncluded, taxAmount, taxRate, customer: { customerId, fullName, phone?, email? }, shippingAddress, discount, shipping: { company, rule }, items: [{ id, productId, variantId, sku, name: { ar, en }, variantName, image: { mediaAssetId, url } | null, quantity, unitPrice, discountAmount, lineTotal, unitCostAtSale? }], statusHistory: [{ fromStatus, toStatus, changedByType, changedById, reason, createdAt }], confirmedAt, createdAt, updatedAt }`. Without `VIEW_CUSTOMER_CONTACT`: no `phone`/`email`, and `shippingAddress` holds only `governorate` and `area`. `unitCostAtSale` only with `VIEW_COST_PRICE`.
- Every response is built from the order's snapshots; later catalog or profile changes never show (Q46, Q184).
- Audit actions added: `ORDER_CONFIRMED`, `ORDER_PREPARING_STARTED`, `ORDER_READY_FOR_SHIPMENT` (entity `ORDER`).
- R34: `POST /me/deactivate` `details.openItems` may now also hold `OPEN_ORDER` (an order not `DELIVERED`, `CANCELLED` or `EXPIRED`).

| Situation | Response |
|---|---|
| Unknown order, or another customer's | `404 NOT_FOUND` |
| Transition not allowed from the current status (for example `confirm` on `PENDING_CONFIRMATION`, or confirming twice) | `409 ORDER_STATE_INVALID`, `details = { status, to }` |
| Missing permission, or the `phone` filter without `VIEW_CUSTOMER_CONTACT` | `403 PERMISSION_DENIED` |

## TASK-031 Amendments

Added by TASK-031 (`docs/tasks/TASK-031-cod-confirmation.md`, ADR-0037). Business rules: Q18, Q24, Q25, Q27, Q31, Q54, R1, R10, R16, R21, R36, R39. Implements `confirm-cod` and `record-phone-confirmation` from §15.

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `POST /orders/{orderId}/confirm-cod` | Secure COD token (no sign-in) | `{ token }` | `200` `{ orderNumber, codConfirmedAt }`; `PENDING_CONFIRMATION → NEW` by the System, source `WHATSAPP`, event `ORDER_COD_CONFIRMED`. Opening a used link again returns the same body. |
| `POST /admin/orders/{orderId}/record-phone-confirmation` | `RECORD_COD_CONFIRMATION` | — | `200` `adminOrder`; `PENDING_CONFIRMATION → NEW` by the System, source `PHONE`, recording employee stored, event `ORDER_COD_CONFIRMED` |

- The link token (`bfo_…`) is issued by the WhatsApp sender for the request and each reminder; each is valid until the order's deadline. The response never shows status, tracking or cancellation (R16).
- `adminOrder` gains `codConfirmation: { deadlineAt, source, confirmedAt, recordedByEmployeeId, reminderCount, lastReminderAt }` and `expiredAt`.
- Status history of the transition: `changedByType = SYSTEM`, `reason` = `COD_CONFIRMED_WHATSAPP` | `COD_CONFIRMED_PHONE`; expiry: `reason = COD_CONFIRMATION_TIMEOUT`.
- Audit actions added (entity `ORDER`): `ORDER_COD_CONFIRMED` (actor: the customer, SYSTEM for guests, or the recording employee) and `ORDER_EXPIRED` (SYSTEM).
- Outbox events (§31) added: `COD_CONFIRMATION_REQUESTED` (checkout, WhatsApp channel only), `COD_CONFIRMATION_REMINDER` (`{ orderId, reminderNumber }`), `ORDER_COD_CONFIRMED` (`{ orderId, source }`), `ORDER_EXPIRED` (`{ orderId }`).
- Jobs (run every few minutes, scheduled by TASK-066): `npm run jobs:send-cod-reminders` (WhatsApp channel only, R39) and `npm run jobs:expire-cod-orders` (`PENDING_CONFIRMATION → EXPIRED` at the deadline; releases stock, discount use and wallet hold).
- `confirm-cod` is rate limited to 20 attempts per IP per hour.

| Situation | Response |
|---|---|
| Unknown or malformed token, a token of another order, or an unknown order | `404 NOT_FOUND` |
| Order no longer `PENDING_CONFIRMATION` (an unused link, or recording twice) | `409 ORDER_STATE_INVALID`, `details = { status, to: "NEW" }` |
| The order's deadline has passed (before the expiry job ran) | `409 ORDER_STATE_INVALID`, `details = { status, to: "NEW", reason: "CONFIRMATION_DEADLINE_PASSED" }` |
| Too many link attempts | `429 RATE_LIMITED`, `details.retryAfterSeconds` |
| Missing `RECORD_COD_CONFIRMATION` | `403 PERMISSION_DENIED` |

## TASK-032 Amendments

Added by TASK-032 (`docs/tasks/TASK-032-order-modification.md`, ADR-0038). Business rules: C4, C5, Q32, R16, R36, R37, R39, R40. Implements `modify` and revision `confirm` from §15.

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `POST /orders/{orderId}/modify` | Customer (own order) | `{ items: [{ variantId, quantity }], addressId? \| address?, walletAmount? }` | `201` `revision` (`PENDING_CONFIRMATION`); the order is unchanged |
| `POST /orders/{orderId}/revisions/{revisionId}/confirm` | Customer (own order) | — | `200` `customerOrder` with the new lines and amounts |

- `items` is the whole new list (each variant once, quantity 1–999); a variant left out is removed. Without `addressId`/`address` the address stays. `walletAmount` defaults to what the order holds, at most the new total.
- Pricing (R40): quantity already ordered keeps its order price; extra quantity and new items take today's price, so one variant may appear twice (order price and today's price). The order's discount is re-applied with its order-time terms or dropped (`discountDropped`); shipping is quoted again.
- `revision`: `{ id, revisionNumber, status, oldTotal, newTotal, expiresAt, createdAt, confirmedAt, proposed: { items: [{ variantId, sku, name, variantName, quantity, unitPrice, discountAmount, lineTotal }], subtotal, discountTotal, discountDropped, shippingFee, freeShipping, total, walletAmount, codAmount, shippingAddress } }`. `status` = `PENDING_CONFIRMATION` | `CONFIRMED` | `SUPERSEDED` | `EXPIRED`; an open revision shows `EXPIRED` once 24 hours have passed or the order reached Preparing.
- `customerOrder` gains `pendingRevision` (`revision` or null). `adminOrder` gains `revisions: [{ id, revisionNumber, status, oldTotal, newTotal, createdAt, confirmedAt }]`.
- Confirming re-prices the revision; any difference (price, stock, shipping, wallet) is `409 RECONFIRMATION_REQUIRED` and the order stays unchanged. On success the stock and wallet holds move to the new amounts, a dropped discount's use is given back, a `CONFIRMED` order goes back to `NEW` (history actor the customer, `reason = ORDER_REVISED`), and a `PENDING_CONFIRMATION` order whose wallet now covers the total moves to `NEW` (`WALLET_COVERS_TOTAL`).
- Revisions are confirmed by the signed-in customer only (R40); the secure-token path listed in §15 is not used.
- Audit actions added (entity `ORDER`, actor the customer): `ORDER_REVISION_REQUESTED`, `ORDER_REVISED`. Outbox event `ORDER_REVISED` (`{ orderId, revisionId, revisionNumber }`).

| Situation | Response |
|---|---|
| Unknown order, another customer's, or unknown revision | `404 NOT_FOUND` |
| Order is `PREPARING` or later, cancelled or expired | `409 ORDER_STATE_INVALID`, `details = { status, reason: "NOT_EDITABLE" }` |
| The request changes nothing | `409 CONFLICT`, `details.reason = NO_CHANGE` |
| Revision replaced, already confirmed or lapsed | `409 CONFLICT`, `details.reason` = `REVISION_SUPERSEDED` \| `REVISION_CONFIRMED` \| `REVISION_EXPIRED` |
| Re-pricing at confirmation differs | `409 RECONFIRMATION_REQUIRED`, `details.reason = REVISION_CHANGED` |
| Extra quantity not available or not purchasable | `409 STOCK_CHANGED`, `details.items` |
| Wallet amount above the total / not enough credit | `400 VALIDATION_ERROR` / `422 WALLET_INSUFFICIENT_FUNDS` |
| No delivery rule for the new address | `422 SHIPPING_UNAVAILABLE` |

## TASK-033 Amendments

Added by TASK-033 (`docs/tasks/TASK-033-cancellation-expiration.md`, ADR-0039). Business rules: Q10, Q28, Q33, Q86, Q87, R3, R11, R16, R36, Audit Correction 5. Implements both `cancel` endpoints from §15. `request-shipping-cancellation` and the customer `cancel` of a `SHIPPED` order (recorded on the Shipment) come with TASK-036, once shipments exist (TASK-034).

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `POST /orders/{orderId}/cancel` | Customer (own order) | `{ reason? }` (1–500 characters; the body may be empty) | `200` `customerOrder` (`CANCELLED`) |
| `POST /admin/orders/{orderId}/cancel` | `CANCEL_ORDER` | `{ reason }` (required, 1–500 characters, Q86) | `200` `adminOrder` (`CANCELLED`) |

- Accepted while the order is `PENDING_CONFIRMATION`, `NEW`, `CONFIRMED`, `PREPARING` or `READY_FOR_SHIPMENT` (R11). One transaction moves it to `CANCELLED` (`cancelled_at`; history actor the customer or employee with the reason), gives back its reserved stock (`RELEASE_RESERVATION` movements), its discount use (R36) and its wallet hold (no ledger entry), writes the audit entry and the outbox event.
- An open revision (TASK-032) then shows as `EXPIRED`; a COD link of the order no longer confirms (`ORDER_STATE_INVALID`); the expiry job skips the order.
- `adminOrder` gains `cancelledAt`. The customer sees the cancellation in `statusHistory`.
- Audit action added (entity `ORDER`): `ORDER_CANCELLED` (actor the customer or the employee, `reason`). Outbox event `ORDER_CANCELLED` (`{ orderId, cancelledBy: "CUSTOMER" | "EMPLOYEE", correlationId }`).
- A repeated cancel is refused (`ORDER_CANCELLATION_NOT_ALLOWED`, `details.status = CANCELLED`); nothing is released twice.

| Situation | Response |
|---|---|
| No customer session (guests cannot cancel online, R16) | `401 UNAUTHENTICATED` |
| Unknown order or another customer's | `404 NOT_FOUND` |
| Staff without `CANCEL_ORDER` | `403 PERMISSION_DENIED` |
| Missing/blank staff reason, reason over 500 characters | `400 VALIDATION_ERROR` |
| Order `SHIPPED` (after carrier pickup) | `422 ORDER_CANCELLATION_NOT_ALLOWED`, `details = { status: "SHIPPED", reason: "AFTER_CARRIER_PICKUP" }`. Interim for the customer endpoint until TASK-036 records the shipping cancellation request instead (§15). |
| Order `DELIVERED`, `CANCELLED` or `EXPIRED` | `422 ORDER_CANCELLATION_NOT_ALLOWED`, `details.status` |

## TASK-034 Amendments

Added by TASK-034 (`docs/tasks/TASK-034-shipment-core.md`, ADR-0040). Business rules: Q84, Q85, Q126, Q127, R2, R4, R37, R38.7. Implements `mark-shipped` (§15), `assign-shipping`, shipment `tracking` and the delivery path of shipment `status` (§16). `DELIVERY_FAILED` (TASK-035), `RETURN_TO_SENDER` / `RETURNED` (TASK-036) and the contact tasks come later.

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `POST /admin/orders/{orderId}/assign-shipping` | `ASSIGN_SHIPPING` | `{ shippingCompanyId }` | `200` `adminOrder`; the order's carrier changes, the fee does not |
| `POST /admin/orders/{orderId}/mark-shipped` | `MARK_AS_SHIPPED` | optional `{ trackingNumber? }` | `200` `adminOrder`; `READY_FOR_SHIPMENT → SHIPPED`, shipment created, stock committed, wallet hold captured, event `ORDER_SHIPPED` |
| `POST /admin/shipments/{shipmentId}/tracking` | `MANAGE_SHIPMENT` | `{ trackingNumber }` | `200` `shipment` |
| `POST /admin/shipments/{shipmentId}/status` | `MANAGE_SHIPMENT`; `DELIVERED` also `MARK_AS_DELIVERED` | `{ status: "OUT_FOR_DELIVERY" \| "DELIVERED", location?, notes? }` | `200` `shipment`; `DELIVERED` also moves the order `SHIPPED → DELIVERED`, event `ORDER_DELIVERED` |

- `assign-shipping` is accepted while the order is `PENDING_CONFIRMATION` … `READY_FOR_SHIPMENT` (before carrier handoff), for an `ACTIVE` company.
- `mark-shipped` uses the order's assigned company, which must be `ACTIVE`. In one transaction: the order's reserved stock is consumed (`CUSTOMER_ORDER_COMMIT` movements), its wallet hold is captured (`ORDER_WALLET_USE` debit; `adminOrder.walletAmountCaptured`), and the shipment is created with status `SHIPPED`.
- `trackingNumber`: 1–100 of `A–Z a–z 0–9 - _ . /`, unique per shipping company.
- Shipment status moves one step at a time: `SHIPPED → OUT_FOR_DELIVERY → DELIVERED`. Every change writes a shipment event; `location` and `notes` are stored on the event (staff only).
- `shipment`: `{ id, orderId, status, company: { id, code, name }, trackingNumber, shippedAt, deliveredAt, events: [{ id, type, at, location, notes }], createdAt, updatedAt }`. `status` = `SHIPPED` \| `OUT_FOR_DELIVERY` \| `DELIVERY_FAILED` \| `RETURN_TO_SENDER` \| `RETURNED` \| `DELIVERED`; event `type` = `SHIPPED` \| `TRACKING_UPDATED` \| `OUT_FOR_DELIVERY` \| `DELIVERED` (later tasks add theirs).
- `adminOrder` gains `deliveredAt` and `shipments: [shipment]`. `customerOrder` gains `shipments: [{ status, company: { name }, trackingNumber, shippedAt, deliveredAt, events: [{ type, at }] }]` (Q127 tracking; no notes or locations).
- Audit actions added: `ORDER_SHIPPING_ASSIGNED`, `ORDER_SHIPPED`, `ORDER_DELIVERED` (entity `ORDER`), `SHIPMENT_TRACKING_UPDATED`, `SHIPMENT_STATUS_CHANGED` (entity `SHIPMENT`).
- Outbox events (§31): `ORDER_SHIPPED` and `ORDER_DELIVERED`, payload `{ orderId, shipmentId }`.

| Situation | Response |
|---|---|
| Unknown order or shipment | `404 NOT_FOUND` |
| `mark-shipped` not from `READY_FOR_SHIPMENT`, or shipping twice | `409 ORDER_STATE_INVALID`, `details = { status, to: "SHIPPED" }` |
| `assign-shipping` after handoff, or on a cancelled/expired order | `409 ORDER_STATE_INVALID`, `details.status` |
| No company assigned / assigned company inactive at handoff | `409 CONFLICT`, `details.reason = SHIPPING_COMPANY_REQUIRED` / `SHIPPING_COMPANY_INACTIVE` |
| Unknown or inactive company (`assign-shipping`) | `400 VALIDATION_ERROR`, issue code `not_found` / `inactive` (path `shippingCompanyId`) |
| Tracking number used by another shipment of the company | `409 CONFLICT`, `details.reason = TRACKING_NUMBER_TAKEN` |
| Shipment step not allowed (e.g. `SHIPPED → DELIVERED`) | `409 CONFLICT`, `details = { reason: "SHIPMENT_STATE_INVALID", status, to }` |
| `DELIVERED` without `MARK_AS_DELIVERED` | `403 PERMISSION_DENIED` |

## TASK-042 Amendments

Added by TASK-042 (`docs/tasks/TASK-042-wishlist.md`, ADR-0041). Business rules: Q4, Q47, Q48, Q51. Implements the wishlist endpoints of §19; the restock subscription endpoints come with TASK-043.

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /me/wishlist` | Customer | — | `200` `wishlist` |
| `POST /me/wishlist/items` | Customer | `{ variantId }` | `200` `wishlist` (a variant already there: unchanged) |
| `DELETE /me/wishlist/items/{itemId}` | Customer | — | `200` `wishlist` |
| `POST /me/wishlist/items/{itemId}/move-to-cart` | Customer | — | `200` `{ cart, wishlist }`: one unit added to the customer cart (§14 rules; summed into an existing line) and the item removed, atomically |

- `wishlist = { id (null before the first add), items[], itemCount }`, newest first. Item: `{ id, productId, variantId, slug, sku, name, variantName, imageUrl, unitPrice, status, addedAt }`.
- `status`: `AVAILABLE`; `OUT_OF_STOCK` (no available stock; the UI offers Coming Soon / Notify Me, Q47); `UNAVAILABLE` (product not published, variant archived or no price; kept visible, Q48). `unitPrice` (piastres) is null when `UNAVAILABLE`.
- Being on the wishlist never subscribes the customer to restock notifications (Q47, Q51).

| Situation | Response |
|---|---|
| No customer session (guests) | `401 UNAUTHENTICATED` |
| Unknown variant, or one not addable (product not published, variant archived) | `404 NOT_FOUND` |
| Unknown item, or another customer's | `404 NOT_FOUND` |
| 100 items already | `409 CONFLICT`, `details = { reason: "WISHLIST_LIMIT_REACHED", limit: 100 }` |
| Move-to-cart refused by the cart (no stock / unavailable / 50-line limit) | `422 OUT_OF_STOCK` / `404 NOT_FOUND` / `409 CONFLICT`, as `POST /cart/items`; nothing changes |

## TASK-045 Amendments

Added by TASK-045 (`docs/tasks/TASK-045-notification-service.md`, ADR-0043). Business rules: Q53, Q55–Q58, Q61, Q63, R10, R14, R39. Implements the notification rows of §11 (`/me/notifications`) and "Staff notifications and delivery logs".

| Endpoint | Auth | Request | Success |
|---|---|---|---|
| `GET /me/notifications` | Customer | `?page&pageSize&unread=true\|false` | `200` list of `{ id, type, title, body, deepLink: { type, id } \| null, readAt, createdAt }`, newest first, with `pagination` (`unread=true`: unread only; its `total` is the unread count) |
| `POST /me/notifications/{notificationId}/read` | Customer | — | `200` the notification; reading it again keeps the first `readAt` |
| `POST /me/notifications/read-all` | Customer | — | `200` `{ updated }` |
| `GET /admin/me/notifications` | Employee | as `/me/notifications` | `200` the employee's own notifications |
| `POST /admin/me/notifications/{id}/read` | Employee | — | `200` the notification |
| `GET /admin/notifications/deliveries` | `NOTIFICATION_LOG_VIEW` | `?page&pageSize&status&channel&orderId` | `200` list of `{ id, notificationId, orderId, templateKey, locale, channel, recipient?, attemptNumber, status, providerReference, failureReason, createdAt, sentAt }`, newest first; `recipient` only with `VIEW_CUSTOMER_CONTACT` |

- Notifications are rendered in the order's language when created and kept (history). `deepLink.type` is `ORDER` for order messages (Q57).
- Transactional messages (Q53, cannot be switched off), sent after commit by `npm run jobs:dispatch-notifications` from these outbox events (§31): `ORDER_CREATED`, `ORDER_COD_CONFIRMED`, `ORDER_CONFIRMED`, `ORDER_EXPIRED` (in-app for customers + WhatsApp, email fallback) and `COD_CONFIRMATION_REQUESTED`, `COD_CONFIRMATION_REMINDER` (WhatsApp only, with the secure link `WEBSITE_URL/orders/{orderId}/confirm-cod#token=bfo_…`; the page posts the token to `confirm-cod`).
- Fallback goes only to an authorized address: a customer's verified account email, or the guest's checkout email (Q61). Every attempt is a delivery row: `SENT`, `FAILED`, or `FALLBACK_SENT` (a later channel after a failure).
- `/me/preferences` is not added: the language is already `PATCH /me` (`preferredLocale`), and restock channels are chosen per subscription (`restock_subscriptions`, TASK-043). See the task file.

| Error | Response |
|---|---|
| Unknown, malformed or someone else's notification id | `404 NOT_FOUND` |
| No session / wrong session type | `401 UNAUTHENTICATED` / `403 FORBIDDEN` |
| Delivery log without `NOTIFICATION_LOG_VIEW` | `403 PERMISSION_DENIED` |
