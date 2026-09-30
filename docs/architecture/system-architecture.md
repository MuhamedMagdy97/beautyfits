# BeautyFits — System Architecture v1.1

**Status:** Proposed / Ready for Review\
**Depends on:** Business Specification v1.1 + User Flows & State Machines v1.1\
**Primary goal:** Build one reliable backend and database that serve Website, Dashboard, and later Mobile App without over-engineering.

---

## 1. Architecture Principles

1. **One Backend API is the business authority.** Website, Dashboard, and Mobile never implement their own business rules.
2. **One PostgreSQL database is the source of truth for transactional data.**
3. **Modular monolith first.** No microservices unless a real scaling or isolation requirement appears.
4. **Backend validates everything.** Client-side validation improves UX but is never trusted.
5. **Critical operations are transactional.** Checkout, stock reservation/release, wallet ledger updates, and other financial/inventory mutations must be atomic.
6. **External side effects are asynchronous where possible.** Email, WhatsApp, notifications, analytics events, and shipping-provider calls should not unnecessarily block the core database transaction.
7. **Every important business mutation is auditable.**
8. **Historical records are immutable snapshots where necessary.** Orders retain historical product/customer/address/pricing information.
9. **Future Mobile App consumes the same API.** It does not get a second backend or database.
10. **Business rules live in documentation and backend modules, not in UI code.**

---

## 2. High-Level System

```text
                     ┌─────────────────────┐
                     │   Customer Website  │
                     │       Next.js       │
                     └──────────┬──────────┘
                                │
                     ┌──────────┴──────────┐
                     │                     │
                     ▼                     ▼
          ┌──────────────────┐   ┌──────────────────┐
          │ Admin Dashboard │   │  Mobile App      │
          │    Next.js      │   │  React Native    │
          │     (later)     │   │    (later)       │
          └────────┬─────────┘   └────────┬─────────┘
                   │                      │
                   └──────────┬───────────┘
                              ▼
                  ┌─────────────────────────┐
                  │       Backend API       │
                  │    Modular Monolith     │
                  │                         │
                  │ Auth / Catalog / Cart   │
                  │ Orders / Inventory      │
                  │ Returns / Wallet        │
                  │ Purchasing / Shipping  │
                  │ Marketing / Customers  │
                  │ Notifications / Audit  │
                  └────────────┬────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │ PostgreSQL   │  │ Job Queue /  │  │ Object       │
      │              │  │ Workers      │  │ Storage      │
      │ Source of    │  │              │  │ Product media│
      │ Truth        │  │ Email        │  │ / invoices   │
      └──────────────┘  │ WhatsApp     │  └──────────────┘
                        │ Reminders    │
                        │ Expiration   │
                        └──────┬───────┘
                               │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
           Email          WhatsApp       Shipping
          Provider         Provider       Provider(s)
```

---

## 3. Recommended Repository Shape

Use one Git repository with a lightweight monorepo structure. The existing BeautyFits frontend can remain part of the same project rather than being discarded.

```text
beautyfits/
├── apps/
│   ├── web/                # Customer storefront
│   ├── admin/              # Admin dashboard
│   ├── api/                # Backend API / modular monolith
│   └── mobile/             # Future mobile app
│
├── packages/
│   ├── ui/                 # Shared UI components where practical
│   ├── types/              # Shared DTO/domain types only
│   ├── validation/         # Shared schema/validation definitions
│   └── config/             # Shared lint/ts/config conventions
│
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── database/
│   ├── api/
│   ├── security/
│   ├── testing/
│   ├── decisions/
│   └── tasks/
│
├── AGENTS.md
└── README.md
```

### Important

The exact framework/library choice for the API can be finalized after this architecture document. The architectural requirement is **one modular backend**, not a specific framework.

### Current state (TASK-001)

The layout above is the **target** shape, not the current one. The repository currently contains a single Next.js starter project at the repository root (`src/app`); it is not a completed BeautyFits website. Do not move it into `apps/web` until a task explicitly requires the move.

### Backend placement (TASK-002, ADR-0001)

The backend lives in the root Next.js application behind a framework-agnostic boundary:

- `src/server/**`: the backend modular monolith. It holds the shared kernel (config, db, errors, http, logging, health) and business modules under `src/server/modules/<module>/`. Domain code does not import Next.js or React.
- `src/app/api/v1/**/route.ts`: thin HTTP adapters serving the versioned API to the Website, Dashboard, and Mobile App.

This satisfies "one backend API" without a monorepo. Extracting the backend into `apps/api` later stays mechanical.

---

## 4. Backend Architecture

The backend is a **modular monolith**.

Recommended logical modules:

```text
Auth
Users / Customers
Catalog
Cart
Checkout
Orders
Inventory
Purchasing
Suppliers
Shipping
Returns
Wallet
Discounts
Reviews
Wishlist
Notifications
Marketing
Employees / RBAC
Analytics
Audit
Files / Media
Settings
```

Each module owns its business logic and exposes clear interfaces to other modules.

Example:

```text
Checkout Module
  ├── validates cart
  ├── validates prices/discounts
  ├── checks stock
  ├── reserves inventory
  ├── creates order
  └── publishes post-commit events

Inventory Module
  ├── available stock
  ├── reserved stock
  ├── movements
  ├── receiving
  ├── returns
  └── adjustments
```

Modules should not directly manipulate another module's internal data without going through an explicit service/use-case boundary.

---

## 5. Client Responsibilities

### Customer Website

Responsible for:
- Product browsing/search UI
- Cart UI
- Checkout UI
- Account UI
- Wishlist UI
- Order tracking UI
- Return request UI
- Reviews UI
- Wallet UI
- Notifications UI

Not responsible for:
- Trusting prices
- Trusting stock
- Authorizing employee actions
- Calculating final business truth independently

### Admin Dashboard

Responsible for:
- Catalog management
- Orders
- Customers
- Inventory
- Purchasing
- Suppliers
- Shipping
- Returns
- Wallet actions allowed by permission
- Marketing
- Analytics
- Roles/permissions
- Settings
- Audit visibility

The API remains authoritative for every mutation.

### Mobile App

The mobile app consumes the same API and business rules as the website. It is intentionally scheduled after backend + dashboard + website stabilization.

---

## 6. Authentication & Authorization

### Customers

- Phone + Email are both stored; phone is the primary customer identifier.
- Email OTP is used for verification/recovery according to the final business rules.
- Sessions should be secure and revocable.
- Customer can log out from all devices.

### Employees

- Separate employee authorization domain from customer roles.
- Employee login requires stronger authentication (password + OTP/MFA).
- Owner/Admin have mandatory MFA.
- Manager can create employees only within permitted scope.
- Employees cannot create/modify roles unless explicitly permitted (default: no).

### Authorization

Use permission-based authorization in the backend.

Examples:

```text
PRODUCT_EDIT
EDIT_PRODUCT_PRICE
MANAGE_PRODUCT_MEDIA
ADJUST_INVENTORY
CONFIRM_ORDER
START_PREPARING
MARK_AS_SHIPPED
CANCEL_ORDER
MANAGE_MANUAL_REFUNDS
ADJUST_WALLET
VIEW_AUDIT_LOGS
```

UI visibility is not security. The backend must enforce permissions.

---

## 7. Database Strategy

PostgreSQL is the primary transactional database.

Core transactional domains include:

```text
Customers
CustomerAddresses
Products
ProductVariants
Categories
Brands
ProductMedia
Carts
CartItems
Orders
OrderItems
OrderStatusHistory
InventoryBalances
InventoryMovements
InventoryReservations
Suppliers
PurchaseOrders
PurchaseItems
GoodsReceipts
GoodsReceiptItems
SupplierReturns
Returns
ReturnItems
ReturnInspections
Wallets
WalletTransactions
Discounts
DiscountUsages
Wishlists
WishlistItems
Reviews
Notifications
NotificationDeliveries
Campaigns
CampaignRecipients
Employees
Roles
Permissions
RolePermissions
AuditLogs
Settings
AnalyticsEvents
```

Exact table/column design is a separate Database Design phase.

Money is stored and transported as integer minor units (EGP piastres) with a currency; floating point is never used for money. Derived monetary calculations use exact decimal/rational arithmetic, and final results are rounded to the nearest piastre with HALF-UP rounding — one global policy for percentage discounts, tax amounts, partial refunds, and weighted-average-cost derived amounts (Business Spec R9). Money arithmetic belongs in a single shared backend helper, never in UI code.

---

## 8. Inventory Architecture

Inventory is ledger-driven, not a single mutable number.

Core concepts:

```text
Available Stock
Reserved Stock
Damaged / Non-sellable Stock
Inventory Movements
```

Every stock-affecting operation creates an inventory movement.

Examples:

```text
Purchase Receipt       +20
Customer Reservation    hold 2
Order Expired           release 2
Supplier Return        -3
Customer Return         +1
Manual Adjustment      -2
```

The backend must prevent overselling through atomic/concurrency-safe reservation.

---

## 9. Checkout Architecture

Checkout is a protected transactional workflow.

```text
Client Checkout Request
        ↓
Validate Customer / Guest data
        ↓
Re-read product + variant prices
        ↓
Validate stock
        ↓
Validate discount
        ↓
Calculate shipping
        ↓
Check free-shipping threshold on final total
        ↓
Create/resolve idempotency key
        ↓
Database Transaction
   ├── create order
   ├── create order items
   ├── reserve stock
   ├── reserve wallet if used
   └── create order history
        ↓
COMMIT
        ↓
Background notifications / integrations
```

External systems must not be required to complete the database transaction.

---

## 10. Idempotency

Every critical create operation that can be retried must support idempotency.

Priority examples:

- Checkout / Create Order
- Refund creation
- Wallet operations
- Notification send jobs where duplicates are harmful
- Webhook processing from external providers

The API should recognize a repeated request and return the already-created result instead of creating a duplicate business action.

---

## 11. Background Jobs

Background processing is required for:

- COD confirmation reminders
- COD expiration after the configured timeout / maximum 3 days
- Wishlist reminders
- Restock notifications
- Email sending
- WhatsApp sending and retry/fallback
- Campaign delivery
- Analytics aggregation
- Low-stock notifications
- Other scheduled housekeeping

Architecture:

```text
API
 ↓
persist business state
 ↓
enqueue job / event
 ↓
Worker
 ↓
external provider or scheduled action
 ↓
record result / retry / failure
```

Queue technology can be selected during implementation; it should not become a separate microservice.

---

## 12. Notifications

Centralize notifications behind one internal service.

Types:

```text
Transactional
Marketing
Restock
```

The notification service should support channel adapters:

```text
EmailAdapter
WhatsAppAdapter
```

Rules remain in business modules; adapters only deliver messages.

Each delivery should record:
- notification type
- channel
- recipient
- attempt number
- status
- provider response/reference
- timestamp
- failure reason

---

## 13. Shipping Architecture

Use a shipping provider abstraction.

```text
ShippingService
   ├── Provider A Adapter
   ├── Provider B Adapter
   └── Future Provider Adapter
```

BeautyFits business logic should not depend directly on one shipping company's API.

Store:
- shipping company
- tracking number
- shipping status
- attempts
- delivery events
- return-to-sender events

MVP may use manual status updates while keeping the adapter boundary ready for integration.

---

## 14. Returns Architecture

Returns are a separate aggregate/workflow from Orders.

```text
Order = Delivered
        ↓
Return Request
        ↓
Pending Approval
        ↓
Approved
        ↓
Pickup
        ↓
Received
        ↓
Inspection
        ↓
Per-item result
   ├── Restock
   ├── Damaged
   └── Rejected
        ↓
Refund calculation
        ↓
Wallet transaction
```

Partial returns and partial refunds are first-class cases.

Inspection responsibility and customer/shipping fault are recorded separately from the customer's original return reason.

---

## 15. Wallet Architecture

Wallet is ledger-based.

Never silently mutate the customer's balance.

```text
Wallet Balance
    ↑
Wallet Transactions
```

Examples:

```text
RETURN_REFUND +500
ORDER_WALLET_USE -300
MANUAL_ADJUSTMENT +100
REFUND_REVERSAL -100
```

Manual adjustments require strict permission (Owner/Admin default).

When wallet credit is used in a pending order, the amount is reserved until the order outcome is known.

---

## 16. Purchasing Architecture

Purchasing lifecycle:

```text
Purchase Order Draft
        ↓
Pending Approval
        ↓
Approved
        ↓
Sent to Supplier
        ↓
Delivery
        ↓
Inspection
        ↓
Goods Receipt
        ↓
Inventory Increase
```

Supplier invoice remains historically intact.

Differences between ordered, received, and invoiced quantities are recorded rather than silently rewriting the historical invoice.

Over-delivery requires explicit approval before extra quantity is accepted into inventory.

---

## 17. Marketing Architecture

Marketing campaigns are separate from transactional notifications.

```text
Eligible Audience
        ↓
Campaign Draft
        ↓
Review
        ↓
Owner/Admin Approval
        ↓
Send Jobs
        ↓
Delivery Logs
```

Marketing requires valid consent/eligibility and must not be inferred merely from possession of a phone number or account.

Segmentation starts simple and is built from first-party customer behavior/data.

---

## 18. Analytics Architecture

Track first-party funnel events such as:

```text
Page/View
Product View
Add to Cart
Checkout Started
Order Created
Order Confirmed
Order Delivered
Return Requested
```

Guests are represented anonymously.

Analytics should not become the source of truth for orders or inventory. Those remain transactional database domains.

---

## 19. Audit Architecture

Audit logs capture important mutations.

Minimum fields:

```text
Actor
Action
Entity Type
Entity ID
Previous Value / Snapshot where safe
New Value / Snapshot where safe
Timestamp
Request/Correlation ID where useful
```

Important examples:

- price changes
- stock adjustments
- order status changes
- permissions changes
- settings changes
- refunds
- wallet adjustments
- return decisions
- supplier decisions

Historical audit records should not be edited by ordinary users.

---

## 20. File / Media Architecture

Use object storage for:

- Product images
- Supplier invoices
- Return evidence
- Other controlled business documents

Upload pipeline:

```text
Client Upload
 ↓
Authentication + Permission
 ↓
Type/Size/Dimension Validation
 ↓
Security/Malware Validation
 ↓
Object Storage
 ↓
Metadata in PostgreSQL
```

The database stores metadata and references, not large binary files.

---

## 21. Search

Start with PostgreSQL-backed product search/filtering.

Do not introduce a dedicated search engine in v1 unless actual catalog/search scale requires it.

Potential future upgrade:

```text
PostgreSQL Search
      ↓ when justified
Dedicated Search Engine
```

---

## 22. Caching

Do not cache business-critical mutable values in a way that can become authoritative.

Safe candidates later include:

- public catalog reads
- categories/brands
- non-critical dashboard aggregates
- configuration that is explicitly cache-invalidated

Price, stock, wallet, order state, and permissions are revalidated against authoritative state when needed.

---

## 23. Security Boundaries

Required from the beginning:

- secure password storage
- secure sessions/tokens
- MFA for privileged employees
- rate limiting
- abuse protection
- backend authorization
- secure file upload handling
- secret management
- input validation
- output encoding where relevant
- audit logging
- least privilege
- database access restrictions
- encrypted transport

Security is a cross-cutting concern, not a post-MVP feature.

---

## 24. Reliability & Recovery

Backups:

- automated daily backups
- longer-retention weekly backups
- off-system storage/retention where supported

Recovery:

- documented restoration procedure
- restore testing
- recovery checklist
- service verification after restore

Production readiness requires knowing not only that a backup exists, but that it can actually be restored.

---

## 25. Observability

At minimum:

```text
Structured application logs
Error tracking
Request correlation IDs
Background-job logs
Audit logs
Basic health checks
Database monitoring
```

Production debugging must be possible without exposing sensitive customer data in logs.

---

## 26. Deployment Shape

The initial production shape should remain simple:

```text
CDN / Reverse Proxy
        ↓
Web App / Admin App
        ↓
Backend API
        ↓
PostgreSQL
        ↓
Worker / Queue
        ↓
External Providers
```

Scale individual components only when actual load requires it.

---

## 27. Deliberate Non-Choices for Now

The following are intentionally deferred until the next design stage:

- Exact backend framework
- Exact auth library
- Exact queue provider
- Exact object storage provider
- Exact email provider
- Exact WhatsApp provider
- Exact shipping providers/integrations
- Exact hosting provider
- Exact monitoring vendor

These choices should be evaluated against the architecture instead of being allowed to drive the architecture.

**Resolved in TASK-002** (see `docs/decisions/`):

- backend framework/placement: the root Next.js app with `src/server` plus `/api/v1` Route Handlers (ADR-0001);
- ORM and migrations: Prisma 7 + PostgreSQL adapter, with Prisma Migrate (ADR-0003);
- auth library: none; a first-party session-based auth module (ADR-0008);
- also validation (ADR-0005), logging (ADR-0006), configuration (ADR-0007), and testing (ADR-0009).

The other items above remain deferred.

---

## 28. Architecture Decisions That Are Now Fixed

The following are considered architectural invariants:

1. One backend API.
2. One PostgreSQL transactional database.
3. Modular monolith first.
4. Website, Dashboard, and Mobile use the same backend.
5. Backend is authoritative for business logic.
6. Inventory uses reservations + movements.
7. Wallet uses a transaction ledger.
8. Checkout uses atomic DB transactions and idempotency.
9. External notifications/integrations are asynchronous after successful business-state commits where appropriate.
10. Orders, returns, shipping, and inventory have separate state concerns.
11. Employee authorization is permission based.
12. Audit logs are first-class.
13. Product/customer/order history uses snapshots where required.
14. No microservices in v1 without a demonstrated need.

---

## 29. Next Stage

Next document:

**BeautyFits Database Design v1.1**

It will define:
- entities
- relationships
- ownership boundaries
- key constraints
- indexes
- uniqueness rules
- status representations
- transaction boundaries
- inventory and wallet ledgers
- audit storage

Only after the database design is reviewed should implementation tasks be generated.


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

## v1.1 Architecture Additions

### Approval subsystem
A persistent approval-request capability exists for manager-initiated actions that require Owner/Admin approval.

### Supplier finance
Supplier balances, payment/credit/refund settlements, and immutable purchase invoices are handled in the same modular monolith and remain auditable.

### Product/Variant rule
All sellable inventory is variant-level. A simple product uses a Default Variant.

### Existing frontend preservation
The current Next.js application remains in place at the repository root (see §3 "Current state"; Business Spec R8). No large-scale frontend move or rewrite is required merely to adopt the architecture. Add backend/admin/mobile boundaries incrementally.

### Cross-cutting documents
Required before implementation (added in TASK-001):
- `docs/security/security-requirements.md`
- `docs/testing/test-strategy.md`

## TASK-001 Reconciliation

The canonical rule text lives in `docs/product/business-spec.md` (R1–R12). Architectural implications:

| Rule | Architectural implication |
|---|---|
| R1, R10 — COD confirmation | `Pending Confirmation → New` is a System transition triggered by a recorded confirmation event (WhatsApp secure link or staff-recorded phone event); no staff transition path exists. |
| R2, R3, R4 — Order/Shipment separation, shipping cancellation request, Ready for Shipment | Orders and Shipping modules own separate state machines; customer tracking is a composed read model. |
| R5, R9 — Money and rounding | See §7: one shared backend money helper; no money arithmetic in clients. |
| R6 — Wishlist reminders | Background job (§11) gated by marketing consent. |
| R8 — Repository state | See §3 "Current state". |
| R11 — Cancellation window | Enforced by the Orders state machine; post-pickup requests handled by Shipping. |
| R12 — Restock subscriptions | Variant-level, consistent with C6. |
