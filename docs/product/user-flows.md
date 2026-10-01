# BeautyFits User Flows & State Machines v1.1

**Status:** FINAL / Pre-Architecture Source of Truth\
**Depends on:** `BeautyFits Business Specification v1.1`\
**Purpose:** Convert business rules into explicit user/system flows, state transitions, permissions, side effects, and invariants before database and API design.

## 1. Source-of-Truth Hierarchy

`Business Specification → User Flows / State Machines → Architecture → Database → API → Implementation → Tests`

Business rules in this document must not be invented or silently changed by implementation agents. Any new business rule must be marked `[BUSINESS DECISION REQUIRED]` and approved before implementation.

---

## 2. Actors

- **Customer**: authenticated or guest shopper.
- **Owner**: highest-level business authority.
- **Admin**: broad operational/admin authority; cannot transfer ownership.
- **Manager**: department-level authority according to assigned permissions.
- **Employee**: operational user with granular permissions.
- **Warehouse/Receiving Employee**: handles physical receiving and preparation operations.
- **Shipping Company**: external delivery provider.
- **System**: backend, background jobs, notifications, scheduled jobs, validation, inventory and state enforcement.

---

## 3. Customer Account & Authentication Flow

### 3.1 Registration

```text
Customer enters account data
        ↓
Validate email / phone / password policy
        ↓
Account created: Pending Verification (expires after 24 hours)
        ↓
Send Email OTP + WhatsApp OTP to the phone
        ↓
Verify both OTPs
        ↓
Account Active
```

Rules:
- Phone is the primary customer identifier; email is also associated with the account.
- The phone must be an Egyptian mobile number (Business Spec R27).
- Email verification (email OTP) and phone verification (WhatsApp OTP) are both required; the account becomes Active only after both (Business Spec R25).
- A pending registration does not reserve the email or phone; a new registration replaces an unverified pending account (R25).
- A customer cannot log in until the email is verified; with a verified email and a pending phone, only session and verification actions are allowed (R26).
- Password policy: at least 12 characters, allow long passphrases, block common/breached passwords; do not require artificial uppercase/lowercase/number composition.
- OTP expires after 5 minutes.
- Resend is available after 60 seconds.
- Five OTP attempts are allowed before waiting/rate-limit handling.
- OTP abuse is rate-limited by email, IP and device signals.
- Customer sessions use the configured 30-day session policy.
- Customer can log out of all devices.

### 3.2 Forgot Password

```text
Forgot Password
      ↓
Email OTP
      ↓
OTP verification
      ↓
Set new password
      ↓
All existing sessions are revoked (Business Spec R23)
```

### 3.3 Change Email

```text
Authenticated Customer
      ↓
Re-authenticate
      ↓
Enter new email
      ↓
OTP to new email
      ↓
Verify
      ↓
Change email
      ↓
Notify previous email when appropriate
```

### 3.4 Change Phone

```text
Authenticated Customer
      ↓
Re-authenticate
      ↓
Enter new phone
      ↓
OTP to the verified account email (Business Spec R30; email is the only OTP channel in v1)
      ↓
Verify
      ↓
Change phone
      ↓
Notify account via email
```

### 3.5 Guest Order → Account

```text
Guest Order
      ↓
Customer later creates account
      ↓
Same phone detected
      ↓
OTP sent to the email stored on the guest order(s)
      ↓
OTP verification
      ↓
Guest orders whose phone and email both match are linked to the account
```

Phone match alone is never sufficient to claim historical guest orders. Guest orders with a different or missing email are linked only through support (Business Spec R31).

---

## 4. Product Browsing, Wishlist & Restock

### 4.1 Product Lifecycle

```text
Draft
  ↓
Published
  ↓
Available / Out of Stock
  ↓
Archived / Disabled
```

- Draft is the default new-product state.
- Out-of-stock products remain visible.
- Archived products remain historically valid but cannot be purchased.
- Hard delete is prohibited for historical products.
- Every product must have a main image.

### 4.2 Wishlist

```text
Authenticated Customer
      ↓
Add Product to Wishlist
      ↓
Product becomes Out of Stock
      ↓
Wishlist item may appear as Coming Soon / Out of Stock
      ↓
Customer may choose Notify Me
```

Rules:
- Wishlist is account-only.
- A guest cannot access a wishlist.
- Out-of-stock items may remain in wishlist.
- Archived items may remain visible but not purchasable.
- `Notify Me` is a separate explicit restock subscription.
- Restock preferences are per customer/product variant (the canonical sellable unit) and may use email and/or WhatsApp (Business Spec R12).
- A restock notification is sent once per restock cycle; a new cycle requires a new subscription.
- Wishlist purchase reminders are separate from `Notify Me`; cadence, maximum, stop conditions and consent requirements are defined in Business Spec R6.

---

## 5. Review Flow

```text
Successful Purchase
      ↓
Eligible Product
      ↓
Customer submits Rating + Text
      ↓
Verified-purchase / abuse checks
      ↓
Published
      ↓
Admin may hide/moderate later
```

Rules:
- Reviews start in MVP.
- Rating + text are supported.
- Review media is not part of MVP.
- Each successful purchase/order may create one review for the product.
- Each additional successful purchase may create another review.
- A review is published immediately after validation/abuse checks.
- Admin moderation can hide a review but does not hard-delete moderation history.

---

## 6. Cart & Checkout Flow

### 6.1 Cart

```text
Browse Product
      ↓
Select Variant / Quantity
      ↓
Add to Cart
      ↓
Cart stores item intent, not trusted final pricing
```

The backend is authoritative for product availability, price, discounts, shipping and totals.

### 6.2 Checkout Validation

```text
Checkout Started
      ↓
Validate customer/contact information
      ↓
Validate products + variants
      ↓
Validate current price
      ↓
Validate stock + reservation
      ↓
Validate discount
      ↓
Calculate shipping
      ↓
Check free-shipping threshold
      ↓
Calculate final total
      ↓
Customer confirms
      ↓
Create Order transaction
```

Price-change rule:
- If current price differs from the price displayed/held in the cart, the customer must review the changed cart before order creation.

Discount rule:
- Discounts are revalidated at checkout.
- An expired/invalid discount is removed rather than trusted from cart state.
- One discount may be applied per order.
- If several eligible discounts exist, the customer chooses which one to use.
- Percentage discounts can have maximum discount caps.

Free shipping rule:
- Free shipping is calculated from the final order total **after product discounts**.
- Example: 3000 EGP subtotal discounted to 2400 EGP → no free shipping when the threshold is 2500 EGP.

### 6.3 Checkout Transaction Invariant

Order creation, order items, stock reservation and related internal money reservation must be atomic.

```text
DB Transaction
  ├─ Validate / lock required inventory
  ├─ Create order
  ├─ Create order items
  ├─ Reserve inventory
  ├─ Reserve wallet amount if used
  └─ Commit
          ↓
Background jobs / external services
```

External email/WhatsApp/shipping calls must not be kept inside the database transaction.

### 6.4 Duplicate Checkout Prevention

- Every checkout attempt uses an idempotency key.
- Repeated requests with the same idempotency key return the prior result rather than creating a duplicate order.

---

## 7. COD Confirmation Flow

```text
Order Created
      ↓
Pending Confirmation
      ↓
Customer receives confirmation request
      ↓
WhatsApp / Phone path according to availability
      ↓
Customer confirms
  (Phone: authorized staff records the
   confirmation event, source = PHONE)
      ↓
System automatically moves order to New
      ↓
Authorized staff reviews
      ↓
Confirmed
```

Rules:
- COD is the initial payment method.
- Confirmation channel is provider-agnostic and can support WhatsApp/phone according to availability; SMS can be added later.
- Confirmation source: WhatsApp secure link → `WHATSAPP`; phone → `PHONE` recorded by an authorized staff member (actor stored); SMS is future. In both cases the System transitions `Pending Confirmation → New` (Business Spec R10).
- Multiple reminders can be sent during the confirmation window.
- Confirmation timeout is configurable by Admin/Owner but cannot exceed 72 hours (3 days) of elapsed time from order creation (Business Spec R21).
- After timeout: `Pending Confirmation → Expired`.
- Expired orders are not deleted.
- Reserved stock is released on Expired.

---

## 8. Order State Machine

### 8.1 Order lifecycle (commercial/order status)

```text
Pending Confirmation
        ↓
New
        ↓
Confirmed
        ↓
Preparing
        ↓
Ready for Shipment
        ↓
Shipped
        ↓
Delivered
```

Order side states:
- Cancelled
- Expired

`Out for Delivery` and `Delivery Failed` belong to Shipment state, not the core Order status. Return has its own state machine.

### 8.2 Shipment lifecycle

```text
Created / Ready
      ↓
Picked Up / Shipped
      ↓
Out for Delivery
      ↓
Delivered
```

Failure/return path:

```text
Out for Delivery
      ↓
Delivery Failed
      ↓
Retry or Customer Contact
      ↓
Return to Sender
      ↓
Returned
```

### 8.3 Main transition permissions

| Transition | Permission / Actor | Notes |
|---|---|---|
| Pending Confirmation → New | System (automatic) | Triggered when the customer's COD confirmation is received through the configured channel. For phone confirmation, staff record the confirmation event (`RECORD_COD_CONFIRMATION`) and the System then transitions; there is no manual staff transition (Business Spec R1, R10) |
| New → Confirmed | `CONFIRM_ORDER` | Human operational confirmation |
| Confirmed → Preparing | `START_PREPARING` | Warehouse/preparation workflow |
| Preparing → Ready for Shipment | `MARK_READY_FOR_SHIPMENT` | Operational readiness |
| Ready for Shipment → Shipped | `MARK_AS_SHIPPED` | Requires actual carrier handoff + tracking data when available |
| Shipped → Delivered | Carrier/manual status | Manual in MVP; integration later. Reflects the Shipment reaching `Delivered` |
| Pending Confirmation/New/Confirmed/Preparing/Ready for Shipment → Cancelled | Customer (own order) or `CANCEL_ORDER` (staff, reason required) | Allowed while the carrier has not physically received the shipment; releases reserved stock and wallet (Business Spec R11) |
| Shipped → Cancelled | Authorized ops | Only after a shipping cancellation request, the Shipment reaching `Returned`, and inspection for shipping damage (see 8.4) |

Shipment-level transitions (not Order statuses):

| Shipment transition | Permission / Actor | Notes |
|---|---|---|
| Picked Up/Shipped → Out for Delivery | Carrier/manual status | Manual in MVP; integration later |
| Out for Delivery → Delivered | Carrier/manual status | Manual in MVP; integration later |
| Out for Delivery → Delivery Failed | Carrier/manual status | See section 10 |
| Shipping cancellation request (recorded on the Shipment) | `REQUEST_SHIPPING_CANCELLATION` | Not a final cancellation; Order stays `Shipped` |
| → Return to Sender → Returned | Shipping/ops confirmation | Shipment is physically returning to BeautyFits |

### 8.4 Cancellation rule

The customer may cancel until the shipping company physically receives the shipment (allowed statuses: see the transition table above and Business Spec R11).

After carrier pickup there is no direct cancellation; a Shipping Cancellation Request is recorded on the Shipment and the Order remains `Shipped` until the return process completes:

```text
Order: Shipped
  ↓
Shipping Cancellation Requested   (request recorded on the Shipment; Order stays Shipped)
  ↓
Carrier stop/return attempt       (Shipment: Return to Sender)
  ↓
Returned to BeautyFits            (Shipment: Returned)
  ↓
Inspection
  ↓
Order: Cancelled
```

`Shipping Cancellation Requested` and `Returned to BeautyFits` are shipment-level states/events shown in customer tracking; they are not Order statuses (Business Spec R2, R3).

If the customer already received the order, this is not a cancellation; it is a Customer Return.

---

## 9. Order Modification Flow

```text
Eligible Order (< Preparing)
      ↓
Customer edits items / address / discount / shipping / wallet usage
      ↓
Backend recalculates everything
      ↓
Material change?
 ├─ No → Save permitted non-material change
 └─ Yes → Revised confirmation required
             ↓
          Customer confirms
             ↓
          Continue operational workflow
```

Material changes require full revalidation and must not bypass stock, discount, shipping, wallet, or COD rules.

## 10. Delivery Failure Flow

Delivery failure is tracked in Shipment state; the Order remains `Shipped` throughout.

```text
Picked Up/Shipped
  ↓
Out for Delivery
  ↓
Delivery Failed
  ├─ another delivery attempt
  ├─ contact customer task after configured threshold
  └─ eventual Return to Sender
```

- Exact attempt rules may depend on the shipping carrier.
- BeautyFits tracks attempts and failures.
- After repeated failures, a customer-contact task is generated.
- If returned to BeautyFits, inspect for shipping damage before cancelling the order.

---

## 11. Customer Return State Machine

### 11.1 Eligibility

```text
Delivered
   ↓
Within 14 days?
 ├─ No → Return option disabled
 └─ Yes → Customer may submit request
```

The 14-day window starts from actual delivery date. Damaged/defective items do not get a later window under the current policy.

### 11.2 Return Flow

```text
Customer submits Return Request
          ↓
Pending Approval
          ↓
Admin reviews
      ┌───┴────┐
   Reject     Approve
      ↓          ↓
Rejected    Pickup Requested
                 ↓
        Shipping Company Pickup
                 ↓
              Received
                 ↓
             Inspection
                 ↓
      Per-item inspection result
       ┌─────────┼───────────┐
    Restock    Damaged     Rejected
       └─────────┴───────────┘
                 ↓
        Refund Calculation
                 ↓
             Wallet Refund
```

### 11.3 Return Request

- Customer provides a free-text reason.
- Customer can upload evidence.
- Photos are required for damage/wrong-item scenarios and optional for other scenarios.
- Customer pays return shipping by default, but final responsibility may switch to BeautyFits for shipping damage or wrong item.
- Admin may reject; customer can submit a new request rather than mutating historical rejected data.

### 11.4 Inspection

Each returned product/quantity is evaluated independently.

Allowed results:
- Restock
- Damaged / non-sellable
- Rejected

Inspection notes are required/encouraged to document the physical finding.

### 11.5 Customer-caused opened/used condition

If inspection establishes customer-caused opening/use/damage, the resolution can be:

1. Return the product to the customer with no refund, or
2. BeautyFits keeps the product and refunds 25% of the eligible amount actually paid for the affected item quantity to the BeautyFits Wallet.

Policy-value configurability, audit requirements and rounding: Business Spec R7 and R9.

### 11.6 Refund logic

- Full/eligible refunds go to BeautyFits Wallet by default.
- Partial refunds are supported per returned item.
- If a product is damaged by the shipping carrier, the customer does not pay return shipping and the eligible refund is not reduced for customer fault.
- Wrong-item shipments are treated as BeautyFits responsibility.
- Alternative/manual refund methods are permission-controlled and future-extensible.

---

## 12. Wallet Flow

### 12.1 Refund

```text
Return Approved
   ↓
Product Received
   ↓
Inspection Complete
   ↓
Refund Calculation
   ↓
Wallet Transaction
   ↓
Customer Wallet Balance Updated
```

### 12.2 Wallet as Payment Source

Wallet is a real payment balance usable on future orders.

Example:

```text
Wallet = 500
Order = 800

500 → Reserved Wallet Amount
300 → COD
```

On order cancellation/expiration before wallet consumption:
- Reserved wallet amount is released.

On successful order completion:
- Reserved amount becomes consumed.

On applicable refund:
- Refund creates a new Wallet transaction.

Wallet balance is never changed without a ledger transaction.

---

## 13. Inventory State & Movement Flow

### 13.1 Core quantities

```text
Available
Reserved
Damaged / Non-sellable
```

Sellable stock is based on Available quantity; Reserved and Damaged quantities cannot be sold as normal available stock.

### 13.2 Order reservation

```text
Place Order
   ↓
Atomic stock check
   ↓
Reserve required quantity
   ↓
Available / Reserved updated
```

Concurrent checkouts must not oversell the last available quantity.

### 13.3 Release reservation

Reservation is released when an order is cancelled or expired according to the order state.

### 13.4 Inventory ledger

Every stock movement creates an Inventory Movement record, such as:
- Purchase Receipt
- Customer Order / reservation-consumption movement
- Customer Return
- Supplier Return
- Manual Adjustment
- Damage / write-off

Manual stock adjustment requires the `ADJUST_INVENTORY` permission and a mandatory reason.

---

## 14. Purchasing & Supplier Flow

### 14.1 Purchase lifecycle

```text
Draft Purchase Order
        ↓
Pending Approval
        ↓
Approved
        ↓
Sent to Supplier
        ↓
Supplier Delivery
        ↓
Receiving / Inspection
        ↓
Goods Receipt
        ↓
Inventory Increase
```

- Purchase Order can be created by Owner/Admin or the purchasing manager.
- Purchase Order requires approval before final use/send.
- Supplier invoice is uploaded for every purchase.
- Any quantity mismatch or deviation from the invoice/order must be documented in a required description/notes field.

### 14.2 Short delivery

Example: Ordered 100, received 97.

```text
Purchase Order = 100
Goods Receipt = 97
Short = 3
```

The original supplier invoice is not silently rewritten. The system records the actual receipt separately.

### 14.3 Over-delivery

Example: Ordered 100, received 105.

```text
100 → normal receipt
5 → pending approval
```

Owner/Admin decides whether to accept and add the extra quantity or reject/return it.

### 14.4 Supplier return

```text
Received Goods
   ↓
Inspection
   ↓
Damaged / unacceptable items
   ↓
Owner review when required
   ↓
Supplier Return
   ↓
Refund or Supplier Credit
```

Supplier returns should link to the original purchase where possible.

---

## 15. Shipping Assignment & Pricing

### 15.1 Company assignment

```text
Order Ready for Shipment
       ↓
Determine eligible contracted carriers
       ↓
Apply area/company/order-value rules
       ↓
System recommends carrier
       ↓
Authorized employee reviews/changes
       ↓
Carrier assigned
```

### 15.2 Shipping price

Shipping rules may depend on:
- Shipping company
- Governorate / area
- Order value
- Other Dashboard-configured rules

### 15.3 Free shipping

Free shipping is evaluated after product discounts using the final qualifying order total.

---

## 16. Marketing & Notification Flows

### 16.1 Transactional notification

Primary/fallback strategy:

```text
Transactional Event
      ↓
WhatsApp
      ↓
If failed → Email fallback
      ↓
Log every attempt/result
```

Transactional messages cannot be disabled as if they were marketing promotions.

### 16.2 Marketing consent

Marketing requires explicit opt-in.

```text
Account / Guest consent
      ↓
Marketing eligible = true
      ↓
Can enter marketing audience
```

Opt-out immediately removes eligibility for the relevant marketing channel.

### 16.3 Restock notifications

Restock is separately controlled by `Notify Me` preferences and is not assumed from wishlist membership.

Customer can select email, WhatsApp, or both. Notification is sent once per restock cycle.

### 16.4 New-product campaign

```text
Product published
      ↓
Campaign suggestion / authorized staff creates draft
      ↓
Marketing Manager prepares
      ↓
Owner/Admin final approval
      ↓
Send
      ↓
Delivery / failure logs
```

### 16.5 Marketing frequency

Marketing messages are subject to configurable frequency limits to reduce excessive contact.

---

## 17. Employee, Role & Approval Flows

### 17.1 Hierarchy

```text
Owner
 ↓
Admin
 ↓
Manager
 ↓
Employee
```

- Owner/Admin can create managers and employees.
- Managers can create employees but cannot create managers or redesign permissions.
- Employees cannot assign roles.
- Custom roles are created by Owner/Admin.
- Granular permissions control actions.

### 17.2 Sensitive actions

Examples of separate permissions:
- `ADJUST_INVENTORY`
- `EDIT_PRODUCT_PRICE`
- `EDIT_COST_PRICE`
- `MANAGE_PRODUCT_MEDIA`
- `MANAGE_MANUAL_REFUNDS`
- `ADJUST_WALLET`
- `VIEW_AUDIT_LOGS`
- `VIEW_COST_PRICE`
- `VIEW_PROFIT`

### 17.3 Approval pattern

Where a Manager is not authorized to finalize a sensitive transition:

```text
Manager requests action
       ↓
Pending Approval
       ↓
Owner/Admin review
     ↙       ↘
Approve     Reject
```

### 17.4 Employee deactivation

Employee access is deactivated/revoked, not hard-deleted, when business history exists. Historical actions and audit logs remain linked to the employee record.

---

## 18. Audit Log Invariants

Important business actions must record:

- Actor
- Action
- Entity type
- Entity ID
- Previous value when relevant
- New value when relevant
- Reason when required
- Timestamp

Audit logs are not editable by ordinary employees and should be effectively immutable for application-level users.

---

## 19. Analytics Flow

```text
Visitor
  ↓
Product View
  ↓
Add to Cart
  ↓
Checkout
  ↓
Order
  ↓
Delivered
```

Track:
- Anonymous and authenticated visitors
- Product views
- Add-to-cart events
- Checkout starts/abandons
- Orders
- Revenue
- Estimated gross profit
- Inventory alerts
- Product/brand/category performance

Analytics ranges should support Today, Yesterday, 7 Days, 30 Days, 90 Days and Custom Range.

---

## 20. Critical Invariants / Never Break These

1. **Backend is authoritative.** Frontend values are never trusted for price, stock, discounts or permissions.
2. **No overselling.** Inventory reservation must be atomic and concurrency-safe.
3. **No duplicate orders.** Checkout requires idempotency.
4. **No partial checkout state.** Order/stock/wallet reservation uses an atomic transaction.
5. **No historical destruction.** Orders, product snapshots, employee actions and financial ledgers are preserved.
6. **No wallet mutation without a ledger entry.**
7. **No silent status jumps.** Invalid order transitions are rejected by the backend.
8. **Return ≠ cancellation.** Returned orders remain historically delivered; the Return is a separate lifecycle.
9. **Shipping cancellation ≠ customer return.**
10. **Marketing requires consent.**
11. **Return eligibility runs until the end of the 14th calendar day after delivery, in Africa/Cairo (Business Spec R21).**
12. **External notifications are asynchronous.** Notification failure must not roll back a successful order transaction.
13. **Manual money/stock changes require permissions and auditability.**
14. **Archived products remain historically referenceable.**
15. **Backup recovery must be tested, not merely configured.**

---

## 21. Architecture Handoff Rules

This document is complete enough to begin architecture work when paired with `BeautyFits Business Specification v1.1`.

Architecture work must preserve these boundaries:
- Website, Mobile App and Dashboard are clients.
- Backend API is the single business-rule authority.
- PostgreSQL is the system of record.
- Background jobs handle delayed/retriable side effects.
- External integrations must be isolated behind provider-agnostic interfaces where practical.
- Online payments are future-extensible but not part of MVP.
- Shipping integrations are future-extensible; MVP can use manual carrier updates.

### Next source-of-truth document
`docs/architecture/system-architecture.md`

Before designing tables, the architecture must explicitly explain how the state machines and invariants above are enforced.


## v1.1 Closure Decisions and Audit Corrections

The canonical text of closure decisions C1–C6 and of the Pre-Implementation Audit Corrections 1–10 lives only in `docs/product/business-spec.md`. The copies that used to be repeated here were removed in TASK-002A to prevent the documents drifting apart.
