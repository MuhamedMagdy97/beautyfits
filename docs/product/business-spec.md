# BeautyFits Business Specification v1.1

Status: FINAL / Pre-Architecture Source of Truth

## Source of truth order
Business Specification → User Flows / State Machines → Architecture → Database → API Contract → Implementation → Tests

## Consolidated Rules
### Q1 — Core / Payments
**Final decision:** A — Cash on Delivery only
**Rule / notes:** Online payments are deferred; architecture should remain extensible.

### Q2 — Customer Account
**Final decision:** A — Guest Checkout + Account
**Rule / notes:** Guests can browse, cart and checkout without an account.

### Q3 — Reviews
**Final decision:** A — From the beginning
**Rule / notes:** Verified-purchase reviews are supported.

### Q4 — Wishlist
**Final decision:** A — From the beginning
**Rule / notes:** Wishlist is account-only.

### Q5 — Returns
**Final decision:** A — Yes
**Rule / notes:** Request goes to Admin first.

### Q6 — Shipping
**Final decision:** C — Both; Dashboard shipping rules
**Rule / notes:** Rules can vary by company/area/order value; free-shipping threshold configurable.

### Q7 — Delivery Plan
**Final decision:** A — Backend → Dashboard → Website → Mobile
**Rule / notes:** Mobile starts after the core backend/dashboard/website are stable.

### Q8 — Customer Account
**Final decision:** B — Yes, but require OTP verification before linking
**Rule / notes:** Security improvement: phone match alone is not enough.

### Q9 — Inventory
**Final decision:** A — Reserve at order creation
**Rule / notes:** Atomic/concurrency-safe reservation prevents overselling the last item.

### Q10 — Orders / Cancellation
**Final decision:** Custom — Customer may cancel until the shipping company physically receives the shipment
**Rule / notes:** After carrier pickup, use Shipping Cancellation Request; after delivery, use Customer Return.

### Q11 — Reviews
**Final decision:** A — Publish immediately after automated/abuse checks
**Rule / notes:** Verified purchase remains required; Admin can moderate/hide later.

### Q12 — Reviews
**Final decision:** C — One review per successful purchase/order
**Rule / notes:** Each verified purchase can produce a new review.

### Q13 — Marketing / WhatsApp
**Final decision:** B — System suggests campaign; authorized marketing staff can prepare; Owner/Admin approves before sending
**Rule / notes:** No automatic sending.

### Q14 — Returns
**Final decision:** A hybrid — Free-text reason is required; system may also classify it
**Rule / notes:** Customer provides the explanation; final responsibility/reason may be updated after inspection.

### Q15 — Returns
**Final decision:** Custom — Depends on final responsibility/reason
**Rule / notes:** Shipping damage/wrong item: BeautyFits; change of mind/customer-caused condition: customer.

### Q16 — Returns / Refunds
**Final decision:** C + D — Wallet by default; Admin can choose an alternative/manual method
**Rule / notes:** Alternative methods are future/permission-controlled; MVP default is Wallet.

### Q17 — Returns
**Final decision:** A — No, 14 days final
**Rule / notes:** Return eligibility is disabled after 14 days from actual delivery.

### Q18 — COD
**Final decision:** B — Yes, customer confirmation is required before final confirmation
**Rule / notes:** Channel is flexible; current MVP can use WhatsApp/phone, with SMS later.

### Q19 — Shipping
**Final decision:** A + B — Allow carrier attempts and trigger customer-contact task after configurable threshold
**Rule / notes:** Exact attempt policy can depend on the carrier; BeautyFits still tracks failures.

### Q20 — Catalog / Inventory
**Final decision:** A — Yes, show Out of Stock
**Rule / notes:** They can also expose Coming Soon / Notify Me.

### Q21 — Inventory
**Final decision:** A — Yes, per-product threshold
**Rule / notes:** Future purchase suggestions can be generated.

### Q22 — Catalog
**Final decision:** C — Draft by default with optional Publish
**Rule / notes:** Admin controls visibility.

### Q23 — Catalog
**Final decision:** C — Archive/Disable only; hard delete prohibited
**Rule / notes:** Historical orders, reviews and analytics must remain intact.

### Q24 — COD
**Final decision:** E — Flexible confirmation channel; architecture provider-agnostic
**Rule / notes:** Do not tie architecture to one provider.

### Q25 — COD
**Final decision:** E — Configurable, with hard maximum of 3 days
**Rule / notes:** After max timeout: Pending Confirmation → Expired; reserved stock is released.

### Q26 — Wallet
**Final decision:** C — Real Wallet; default refund to Wallet, Admin can choose manual alternative
**Rule / notes:** Wallet is usable on future orders; ledger-based.

### Q27 — Orders / COD
**Final decision:** B — Customer confirmation moves order to New; authorized staff then move New → Confirmed
**Rule / notes:** Final state flow: Pending Confirmation → New → Confirmed.

### Q28 — Inventory
**Final decision:** A — Immediately at order creation
**Rule / notes:** Release on Expired/Cancelled according to order state.

### Q29 — Returns
**Final decision:** A — Receive product → Inspect → Refund
**Rule / notes:** No refund before physical receipt/inspection.

### Q30 — Returns / Inspection
**Final decision:** B — Inspection first, then Restock/Damaged/Rejected
**Rule / notes:** Inspection is per returned item/quantity with notes.

### Q31 — COD
**Final decision:** B — Expired + release reserved stock
**Rule / notes:** Order record remains for history/audit; not physically deleted.

### Q32 — Orders / Editing
**Final decision:** A — Before Preparing
**Rule / notes:** Any change revalidates price, stock, discounts, shipping and total; historical order data is preserved.

### Q33 — Orders / Cancellation
**Final decision:** Custom — Cancel before carrier pickup; after pickup use Shipping Cancellation Request; after delivery use Customer Return
**Rule / notes:** Cancellation is distinct from Return.

### Q34 — Returns
**Final decision:** A — Partial Return
**Rule / notes:** Return lines have their own quantities and inspection results.

### Q35 — Returns / Inspection
**Final decision:** A — Yes, independently
**Rule / notes:** Example: 2 Restock + 1 Customer-damaged.

### Q36 — Returns / Inventory
**Final decision:** Custom — Only after inspection confirms sellable condition; then add to Available Stock
**Rule / notes:** Damaged/opened/rejected items never enter sellable stock.

### Q37 — Cart / Pricing
**Final decision:** C — Notify customer and require review before checkout
**Rule / notes:** Frontend price is not trusted; backend recalculates.

### Q38 — Discounts
**Final decision:** B — Revalidate at checkout
**Rule / notes:** Expired/invalid discount is removed before order creation.

### Q39 — Checkout Reliability
**Final decision:** A — Backend idempotency key per checkout attempt
**Rule / notes:** Return the original result instead of creating a duplicate order.

### Q40 — Checkout Reliability
**Final decision:** A — Atomic database transaction for order/stock/reservation; external messages run after commit
**Rule / notes:** Do not include WhatsApp/email/shipping APIs inside the DB transaction.

### Q41 — Customer Account
**Final decision:** C — Phone + Email; Phone primary
**Rule / notes:** Phone is the main identifier; email is verified and used for recovery/communication.

### Q42 — Authentication
**Final decision:** A — OTP on email
**Rule / notes:** Email verification is required at account creation.

### Q43 — Guest Checkout
**Final decision:** A — Yes; create account and link eligible guest orders after verification
**Rule / notes:** Guest-to-account linking is controlled by secure identity verification.

### Q44 — Guest Orders
**Final decision:** B — Require OTP before linking
**Rule / notes:** Phone match alone is insufficient.

### Q45 — Addresses
**Final decision:** B — Multiple addresses + default
**Rule / notes:** Useful for personal orders and gifts.

### Q46 — Addresses
**Final decision:** A — No; store an address snapshot on the order
**Rule / notes:** Historical order data must not change.

### Q47 — Wishlist
**Final decision:** C — Keep it visible and offer Coming Soon / Notify Me
**Rule / notes:** Wishlist presence alone does not subscribe the customer.

### Q48 — Wishlist
**Final decision:** A — Keep it visible as unavailable
**Rule / notes:** Historical wishlist context is preserved.

### Q49 — Reviews
**Final decision:** C — One verified review per successful purchase/order
**Rule / notes:** Each purchase can have its own experience.

### Q50 — Reviews
**Final decision:** A — Yes; edited review is rechecked by automated moderation/abuse controls, without manual approval
**Rule / notes:** Consistent with final immediate-publish review policy.

### Q51 — Wishlist / Notifications
**Final decision:** C — Wishlist shows status; Notify Me is a separate explicit subscription
**Rule / notes:** Only subscribed users receive restock notifications.

### Q52 — Wishlist / Notifications
**Final decision:** A — One notification per restock event, using opted channels
**Rule / notes:** A new restock event can be subscribed to again if desired.

### Q53 — Notifications
**Final decision:** A — Yes; marketing is user-controlled, transactional notifications remain enabled
**Rule / notes:** Transactional and marketing channels are separate.

### Q54 — COD
**Final decision:** B — Multiple reminders within timeout window
**Rule / notes:** Frequency/maximum can be configurable.

### Q55 — Notifications
**Final decision:** C — WhatsApp fallback for supported transactional notifications
**Rule / notes:** Delivery attempts/results are logged.

### Q56 — Notifications
**Final decision:** C — Email fallback for supported transactional notifications
**Rule / notes:** Delivery attempts/results are logged.

### Q57 — Notifications
**Final decision:** A — Yes
**Rule / notes:** Notifications can deep-link to orders/products.

### Q58 — Notifications
**Final decision:** A — Read/Unread + Mark as read/Mark all
**Rule / notes:** Notifications retain history.

### Q59 — Marketing Consent
**Final decision:** A — Explicit opt-in required
**Rule / notes:** Marketing consent must be separate from transactional notifications; do not pre-enable by default.

### Q60 — Marketing Consent
**Final decision:** A — Stop Email Marketing only; transactional email continues
**Rule / notes:** WhatsApp marketing is managed separately.

### Q61 — Notifications
**Final decision:** A — WhatsApp primary, email fallback
**Rule / notes:** Applicable where the customer/channel is eligible.

### Q62 — Restock Notifications
**Final decision:** C — Separate Restock Notification preferences
**Rule / notes:** Restock is explicit product notification, separate from general marketing.

### Q63 — Notifications
**Final decision:** B — System determines channels using notification type + consent/preferences
**Rule / notes:** Keep MVP simple; channel policy is backend/config driven.

### Q64 — Employees
**Final decision:** Custom — Invite employee by work email; deactivate access without deleting business history
**Rule / notes:** Employee record remains for audit/history.

### Q65 — Employees / Hierarchy
**Final decision:** Custom — Owner/Admin can create Managers and Employees; Manager can create Employees only; Employees cannot assign roles
**Rule / notes:** Role assignment is enforced server-side.

### Q66 — Roles
**Final decision:** A — Yes
**Rule / notes:** Granular permissions are attached to roles.

### Q67 — Permissions
**Final decision:** A — Yes
**Rule / notes:** Examples: view/create/edit/archive/approve/refund/etc.

### Q68 — Sensitive Data
**Final decision:** B — Owner/Admin + Inventory Manager by default, still enforced via permissions
**Rule / notes:** Sensitive financial visibility remains restricted.

### Q69 — Employees
**Final decision:** B — Deactivate; keep historical actions/logs
**Rule / notes:** Never hard-delete an employee who has business activity.

### Q70 — Audit Logs
**Final decision:** A — Actor, action, entity, entity ID, old/new value, timestamp
**Rule / notes:** Audit is immutable from normal staff workflows.

### Q71 — Inventory / Permissions
**Final decision:** D — Dedicated ADJUST_INVENTORY permission
**Rule / notes:** High-risk operation; reason required.

### Q72 — Inventory
**Final decision:** A — Yes, required
**Rule / notes:** Reason is stored in inventory movement + audit log.

### Q73 — Pricing / Permissions
**Final decision:** D — Separate EDIT_PRODUCT_PRICE permission
**Rule / notes:** Keep price changes separate from normal catalog editing.

### Q74 — Pricing / Permissions
**Final decision:** B — Owner/Admin + Inventory Manager
**Rule / notes:** Cost price is sensitive.

### Q75 — Catalog
**Final decision:** A — Archive/Disable only
**Rule / notes:** Historical records must remain.

### Q76 — Order Status Permissions
**Final decision:** Custom — Operational staff can perform allowed transitions; sensitive manager transitions can enter Pending Approval for Owner/Admin
**Rule / notes:** Backend validates transition graph and approvals.

### Q77 — Refunds / Permissions
**Final decision:** C — Dedicated MANAGE_MANUAL_REFUNDS
**Rule / notes:** Reason + audit log required.

### Q78 — Wallet / Permissions
**Final decision:** A — Owner/Admin only
**Rule / notes:** Every adjustment creates an immutable wallet transaction with reason.

### Q79 — Audit Logs
**Final decision:** A — Owner/Admin only
**Rule / notes:** Full audit visibility is restricted.

### Q80 — Sensitive Data
**Final decision:** B/C — Permission-based, with secure role defaults
**Rule / notes:** Examples: customer phone/address, wallet, cost, profit each have appropriate access control.

### Q81 — Order State Machine
**Final decision:** A — System automatically moves to New after customer confirmation
**Rule / notes:** Authorized staff then review New → Confirmed.

### Q82 — Order State Machine
**Final decision:** D — Anyone with CONFIRM_ORDER permission
**Rule / notes:** Backend checks role/permission.

### Q83 — Order State Machine
**Final decision:** D — Anyone with START_PREPARING
**Rule / notes:** Warehouse/preparation roles can receive this permission.

### Q84 — Order State Machine
**Final decision:** D — Dedicated MARK_AS_SHIPPED permission
**Rule / notes:** Carrier/tracking details recorded at shipment.

### Q85 — Order State Machine
**Final decision:** D — Manual confirmation now; carrier integration later
**Rule / notes:** Keep integration-ready.

### Q86 — Order State Machine
**Final decision:** D — Dedicated CANCEL_ORDER permission
**Rule / notes:** Reason required; reserved stock released.

### Q87 — Order State Machine
**Final decision:** A — Yes
**Rule / notes:** Cancellation window ends when carrier physically receives the shipment.

### Q88 — Order State Machine
**Final decision:** D — Dedicated REQUEST_SHIPPING_CANCELLATION permission
**Rule / notes:** This is a request, not immediate final cancellation.

### Q89 — Shipping Cancellation
**Final decision:** C — Shipped → Cancellation Requested → Returned to BeautyFits → Cancelled
**Rule / notes:** Keeps shipping history distinct from customer returns.

### Q90 — Returns
**Final decision:** A — Order remains Delivered; a separate Return Request lifecycle begins
**Rule / notes:** This enables partial returns.

### Q91 — Returns
**Final decision:** B — Pending Approval
**Rule / notes:** Admin reviews eligibility/reason/evidence.

### Q92 — Returns
**Final decision:** C — Rejected; customer may submit a new/corrected request
**Rule / notes:** Do not rewrite the old rejected record.

### Q93 — Returns / Shipping
**Final decision:** B — BeautyFits contacts the shipping company to collect from the customer
**Rule / notes:** Customer does not need to self-deliver the return.

### Q94 — Returns / Inspection
**Final decision:** B — Warehouse/authorized employee starts inspection
**Rule / notes:** Admin does not need to perform every physical inspection.

### Q95 — Returns / Inspection
**Final decision:** A — Restock / Damaged / Rejected + inspection notes
**Rule / notes:** Result is per returned line/item.

### Q96 — Returns / Refunds
**Final decision:** A — Yes
**Rule / notes:** Different returned items can receive different outcomes.

### Q97 — Returns / Refunds
**Final decision:** A — Auto-refund eligible amount to Wallet after completed inspection; exception requires human resolution
**Rule / notes:** Customer-caused damage can trigger special resolution.

### Q98 — Returns / Shipping
**Final decision:** Custom — Rule-based by cause: shipping/wrong-item = BeautyFits pays; change of mind/customer-caused = customer pays; customer-caused used/damaged may incur deduction
**Rule / notes:** Refund amount depends on inspection/responsibility.

### Q99 — Returns
**Final decision:** A — Customer reason required; final assessed reason/responsibility recorded after inspection
**Rule / notes:** Customer reason and final assessment are distinct.

### Q100 — Returns / Evidence
**Final decision:** A — Photos required for damage/wrong-item cases; optional otherwise, with description
**Rule / notes:** Evidence is attached to the Return Request.

### Q101 — Purchasing
**Final decision:** Custom — Purchase Order → supplier delivery → review/inspection → Goods Receipt → stock update
**Rule / notes:** No stock increase from PO creation alone.

### Q102 — Purchasing / Cost
**Final decision:** A — Each purchase keeps its own unit cost
**Rule / notes:** If new cost reduces margin, show selling-price review warning.

### Q103 — Inventory Costing
**Final decision:** Custom — Keep Latest Purchase Cost for display/warnings; use Weighted Average Cost for inventory valuation/COGS; store unit cost at sale
**Rule / notes:** Historical profit must not change after later purchases.

### Q104 — Purchasing / Inventory
**Final decision:** B — After inspection and Goods Receipt
**Rule / notes:** Damaged/unaccepted quantities do not enter sellable stock.

### Q105 — Supplier Returns
**Final decision:** Custom — Record original invoice/purchase, inspect, Owner review, then Supplier Return for damaged quantity
**Rule / notes:** Do not erase original purchase history.

### Q106 — Supplier Returns
**Final decision:** A — Yes, whenever possible
**Rule / notes:** Preserves traceability.

### Q107 — Supplier Settlement
**Final decision:** C — Refund or Supplier Credit depending on agreement
**Rule / notes:** Financial settlement recorded.

### Q108 — Inventory
**Final decision:** A — Yes, every movement
**Rule / notes:** Examples: purchase receipt, sale reservation/release, customer return, supplier return, manual adjustment.

### Q109 — Inventory
**Final decision:** C/A — Available + Reserved + separate Damaged/Non-sellable quantity
**Rule / notes:** Sellable stock excludes Reserved/Damaged.

### Q110 — Inventory Alerts
**Final decision:** D — Admin + Inventory/Warehouse staff; future purchase suggestion
**Rule / notes:** Purchase creation remains human-approved.

### Q111 — Pricing
**Final decision:** Custom — Owner can set manual price or target margin; system calculates a suggestion; Owner reviews/approves
**Rule / notes:** No automatic price overwrite; warning when cost changes materially.

### Q112 — Purchasing
**Final decision:** Owner/Admin + Purchasing Manager
**Rule / notes:** Manager is limited by purchasing permissions.

### Q113 — Purchasing / Approval
**Final decision:** A — Yes; Draft → Pending Approval → Approved → Sent
**Rule / notes:** Approver must have purchasing approval authority.

### Q114 — Purchasing / Receiving
**Final decision:** Warehouse Receiving Employee + Warehouse Manager, per permission
**Rule / notes:** Both can receive; audit records who did it.

### Q115 — Purchasing / Receiving
**Final decision:** Receive 97 in Goods Receipt; keep original PO/invoice unchanged; record 3-unit shortfall
**Rule / notes:** Original invoice is not edited just to match receipt.

### Q116 — Purchasing / Receiving
**Final decision:** C + D — Accept ordered quantity; extra 5 go to Pending Approval for Owner/Admin decision
**Rule / notes:** Approved extras can be added to the purchase/receipt.

### Q117 — Purchasing / Documents
**Final decision:** A — Yes, mandatory; discrepancy description is mandatory when recorded system quantity differs from invoice
**Rule / notes:** Keep file linked to purchase.

### Q118 — Supplier Finance
**Final decision:** B — Paid / Partially Paid / Unpaid
**Rule / notes:** Even without a full accounting module.

### Q119 — Supplier Finance
**Final decision:** A — Yes
**Rule / notes:** Track payable balance and settlements.

### Q120 — Supplier Returns
**Final decision:** A + C — System calculates expected refund/credit from cost; Admin records/overrides settlement method
**Rule / notes:** Financial effect is traceable.

### Q121 — Shipping
**Final decision:** Custom — Use contracted companies + shipping rules to select/propose a company; authorized staff can review/adjust
**Rule / notes:** No company is chosen outside the contracted set.

### Q122 — Shipping Pricing
**Final decision:** D — Governorate/Area + Shipping Company + Order Value + configurable rules
**Rule / notes:** Dashboard controls rules.

### Q123 — Free Shipping
**Final decision:** Custom — Based on final order total after product discounts
**Rule / notes:** Example: 3000 → 2400 after discount = no free shipping.

### Q124 — Shipping Rules
**Final decision:** Custom — Final discounted order total is the basis
**Rule / notes:** Keep policy in Dashboard settings, but current rule is final total after discounts.

### Q125 — Discounts
**Final decision:** Custom — One discount per order; if multiple eligible discounts exist, customer chooses one
**Rule / notes:** Backend revalidates selected discount at checkout.

### Q126 — Shipping
**Final decision:** C — System selects/proposes from contracted companies by rules; employee can adjust with permission
**Rule / notes:** Selection remains within contracted set.

### Q127 — Order Tracking
**Final decision:** Custom — Pending Confirmation → New → Confirmed → Preparing → Ready for Shipment → Shipped → Out for Delivery → Delivered
**Rule / notes:** Side statuses: Delivery Failed, Shipping Cancellation Requested, Returned to BeautyFits, Cancelled, Expired.

### Q128 — Shipping
**Final decision:** B — Delivery Failed
**Rule / notes:** Do not mark Cancelled just because one attempt failed.

### Q129 — Shipping
**Final decision:** A + B — Carrier attempts continue; after configurable threshold create customer-contact task
**Rule / notes:** Carrier-specific attempts are tracked.

### Q130 — Shipping Returns
**Final decision:** Custom — Returned to BeautyFits → inspect → classify shipping damage if present → cancel customer order
**Rule / notes:** Separate from Customer Return.

### Q131 — Discounts
**Final decision:** A — Percentage only
**Rule / notes:** Fixed-value discounts can be added later if needed.

### Q132 — Discounts
**Final decision:** C — Product + Category + Brand + Store-wide; system may suggest promotions for low-demand/low-engagement products
**Rule / notes:** Suggestions require Admin/marketing approval.

### Q133 — Discounts
**Final decision:** C — Optional per discount
**Rule / notes:** Admin chooses whether/what minimum applies.

### Q134 — Discounts
**Final decision:** A — Yes
**Rule / notes:** Example: 20% capped at 20,000 EGP.

### Q135 — Discounts
**Final decision:** A — Overall + Per Customer
**Rule / notes:** Both can be configured.

### Q136 — Discounts
**Final decision:** B — Revalidate at checkout
**Rule / notes:** Consistent with Q38; no discount is guaranteed until checkout.

### Q137 — Discounts
**Final decision:** B — Product-specific discount no longer applies to an unavailable product
**Rule / notes:** Discount remains defined for other eligible products where appropriate.

### Q138 — Discounts
**Final decision:** Custom — Customer explicitly chooses one eligible discount; only one is applied
**Rule / notes:** Do not silently choose for the customer.

### Q139 — Marketing
**Final decision:** A + Marketing-authorized employee — draft campaign; Owner/Admin approves before send
**Rule / notes:** No auto-send.

### Q140 — Marketing Audience
**Final decision:** Opted-in account customers and eligible previous buyers/segments
**Rule / notes:** Must satisfy marketing consent.

### Q141 — Marketing Segmentation
**Final decision:** Recommended MVP: All Opted-in, Previous Buyers, Buyers by Product/Brand/Category, Inactive X days, High-spending customers
**Rule / notes:** Keep segmentation basic/configurable; advanced segmentation later.

### Q142 — Marketing Approval
**Final decision:** B — Owner/Admin final approval
**Rule / notes:** Campaign send requires approval.

### Q143 — Marketing Delivery
**Final decision:** D — Retry then Email fallback
**Rule / notes:** Every attempt/failure is logged.

### Q144 — Marketing
**Final decision:** A — Yes, frequency limit
**Rule / notes:** Configurable to avoid over-messaging.

### Q145 — Analytics
**Final decision:** A — Every meaningful product view
**Rule / notes:** Implementation should filter obvious bot/refresh noise.

### Q146 — Analytics
**Final decision:** A — Anonymous tracking
**Rule / notes:** No need for named identity.

### Q147 — Analytics
**Final decision:** A — Yes
**Rule / notes:** Used in funnel analytics.

### Q148 — Analytics
**Final decision:** A — Yes
**Rule / notes:** Guests and accounts can appear in funnel metrics.

### Q149 — Analytics
**Final decision:** Recommended: Today, Yesterday, 7D, 30D, 90D, Custom Range
**Rule / notes:** Support period comparison later.

### Q150 — Analytics / Profit
**Final decision:** D — Estimated Gross Profit in MVP; broader Net Profit later
**Rule / notes:** Use revenue - COGS for MVP; add shipping/marketing/returns/opex later.

### Q151 — Customer Account
**Final decision:** A — Reject duplicate email; direct to login/recovery
**Rule / notes:** Avoid duplicate identities.

### Q152 — Authentication
**Final decision:** Custom — Re-authenticate, verify new email via OTP, notify old email
**Rule / notes:** Sensitive identity change requires stronger verification.

### Q153 — Authentication
**Final decision:** Custom — Re-authenticate, OTP to new phone, send notification to verified email
**Rule / notes:** Phone is the primary identifier; stronger change flow required.

### Q154 — Customer Account
**Final decision:** B — Deactivate/Anonymize while retaining necessary order/audit/legal records
**Rule / notes:** No destructive delete of historical transactions.

### Q155 — Guest / Privacy
**Final decision:** A + explicit consent — Keep order-required data; only use for marketing if separate valid consent exists
**Rule / notes:** Marketing is never implied by simply placing an order.

### Q156 — Authentication / Password
**Final decision:** 12+ characters; allow long passwords; check against common/breached passwords; no forced composition rules
**Rule / notes:** More aligned with current authentication guidance.

### Q157 — Authentication / Abuse
**Final decision:** Rate limiting + progressive controls + CAPTCHA when suspicious
**Rule / notes:** CAPTCHA is a layer, not the only control.

### Q158 — Authentication / OTP
**Final decision:** B — 5 attempts then temporary wait/lock
**Rule / notes:** Log abuse events.

### Q159 — Authentication / OTP
**Final decision:** A — 5 minutes
**Rule / notes:** Short-lived OTP.

### Q160 — Authentication / OTP
**Final decision:** B — 60 seconds
**Rule / notes:** Rate-limit resend.

### Q161 — Authentication / OTP
**Final decision:** A — Rate-limit by email + IP + device where possible
**Rule / notes:** Use layered abuse prevention.

### Q162 — Authentication / Sessions
**Final decision:** B — 30 days
**Rule / notes:** Session revocation remains possible.

### Q163 — Authentication / Sessions
**Final decision:** C — Admin/configurable with safer defaults than customer sessions
**Rule / notes:** Sensitive staff sessions should be shorter/stricter.

### Q164 — Authentication / Sessions
**Final decision:** A — Yes
**Rule / notes:** Revokes active sessions.

### Q165 — Authentication / MFA
**Final decision:** B — Email + password + OTP; Owner/Admin also require MFA
**Rule / notes:** High-privilege accounts get mandatory MFA.

### Q166 — Wallet
**Final decision:** A — Yes
**Rule / notes:** Visible in account and checkout.

### Q167 — Wallet
**Final decision:** A — Yes, full or partial
**Rule / notes:** Remaining amount can use COD.

### Q168 — Wallet + COD
**Final decision:** A — Yes
**Rule / notes:** Example: Wallet 500 + COD 300 for an 800 order.

### Q169 — Wallet
**Final decision:** A — No
**Rule / notes:** Balance does not expire by default.

### Q170 — Wallet
**Final decision:** A — Transaction Ledger + derived/current balance
**Rule / notes:** No direct balance mutation without a transaction.

### Q171 — Reviews
**Final decision:** B — Rating + text
**Rule / notes:** 1–5 rating plus written text.

### Q172 — Reviews
**Final decision:** B — No in MVP
**Rule / notes:** Can be added later.

### Q173 — Reviews / Moderation
**Final decision:** A — Publish immediately after automated/abuse checks
**Rule / notes:** Admin can moderate/hide later; verified purchase still required.

### Q174 — Reviews / Moderation
**Final decision:** A — Hide from public view but keep moderation history/reason internally
**Rule / notes:** Do not hard-delete moderation history.

### Q175 — Catalog / Media
**Final decision:** B — Dedicated MANAGE_PRODUCT_MEDIA permission
**Rule / notes:** Separate media management from general catalog editing.

### Q176 — Catalog / Media
**Final decision:** C — Type + size + dimensions + security/malware validation
**Rule / notes:** Backend must validate; frontend checks are not enough.

### Q177 — Catalog / Media
**Final decision:** C — Configurable
**Rule / notes:** Applies per product/variant as designed.

### Q178 — Catalog / Media
**Final decision:** A — Yes
**Rule / notes:** Published product cannot go live without a main image.

### Q179 — Settings
**Final decision:** A — Owner/Admin only
**Rule / notes:** Managers do not change core rules by default.

### Q180 — Settings / Approvals
**Final decision:** B — Owner/Admin approval for critical settings
**Rule / notes:** Examples: return period, shipping threshold, COD timeout, refund policy.

### Q181 — Settings / Audit
**Final decision:** A — Old value + new value + actor + timestamp
**Rule / notes:** Critical settings also appear in audit logs.

### Q182 — Backup / Recovery
**Final decision:** D — Automated daily backup + weekly backup/longer retention
**Rule / notes:** Encrypted, off-environment backups; retention policy required.

### Q183 — Backup / Recovery
**Final decision:** C — Backup + documented recovery plan + restore testing
**Rule / notes:** A backup is not enough without a tested restore process.

### Q184 — Orders / Historical Data
**Final decision:** A — Product name, price, image, variant/SKU snapshot at purchase
**Rule / notes:** Historical order data must not change.

### Q185 — Orders / Historical Data
**Final decision:** A — Customer name, phone, email, shipping address snapshot at order time
**Rule / notes:** Historical transactions must remain stable.

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
   - Shipment lifecycle: `Created/Ready → Picked Up/Shipped → Out for Delivery → Delivered`; failure/return path: `Out for Delivery → Delivery Failed → Return to Sender → Returned` (aligned with R2 and User Flows §8.2 in TASK-002A).
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

## v1.1 TASK-001 Reconciliation (Documentation Consistency)

R1–R5 and R8 reconcile wording across the source-of-truth documents without changing business intent; each cites the decision it clarifies. R6, R7 and R9–R12 are final product-owner closure decisions made during TASK-001 and are recorded in `docs/decisions/business-rules-ledger.xlsx` on the "Closure & Audit Decisions" worksheet.

### R1 — Pending Confirmation → New is automatic
- When the customer's COD confirmation is received through the configured confirmation channel, the System moves the order `Pending Confirmation → New` automatically (Q27, Q81, Audit Correction 2).
- There is no manual staff transition from `Pending Confirmation` to `New`. For phone confirmations, staff record the confirmation event and the System performs the transition (R10).
- Authorized staff with `CONFIRM_ORDER` then perform `New → Confirmed` (Q82).

### R2 — Order status and Shipment status are separate
- Order statuses: `Pending Confirmation`, `New`, `Confirmed`, `Preparing`, `Ready for Shipment`, `Shipped`, `Delivered`, plus `Cancelled` and `Expired` (Audit Correction 1).
- Shipment statuses: `Created/Ready`, `Picked Up/Shipped`, `Out for Delivery`, `Delivery Failed`, `Return to Sender`, `Returned`, `Delivered` (Audit Correction 1).
- The customer-facing tracking timeline in Q127 (including `Out for Delivery`, `Delivery Failed`, `Shipping Cancellation Requested`, `Returned to BeautyFits`) is a **display composed from Order status + Shipment status + shipment events**. It does not add statuses to the Order state machine.

### R3 — Shipping cancellation request is not an Order status
- After carrier pickup, a shipping cancellation (Q33, Q88, Q89) is recorded as a request against the shipment (shipment event + audit log), performed with `REQUEST_SHIPPING_CANCELLATION`. The Order remains `Shipped` while the request is in progress.
- The shipment proceeds `Return to Sender → Returned`. After the returned shipment is received by BeautyFits and inspected for shipping damage (Q130), the Order moves `Shipped → Cancelled`.
- The Q89 sequence "Shipped → Cancellation Requested → Returned to BeautyFits → Cancelled" is preserved as the business sequence; only `Shipped` and `Cancelled` are Order statuses.

### R4 — Ready for Shipment is a real Order transition
- `Preparing → Ready for Shipment` requires `MARK_READY_FOR_SHIPMENT`; `Ready for Shipment → Shipped` requires `MARK_AS_SHIPPED` and confirms actual carrier handoff (Q84, Audit Correction 3). There is no direct `Preparing → Shipped` transition.

### R5 — Money representation
- All monetary amounts are represented as **integer minor units** (EGP piastres) in the database and API, together with a currency. Floating point is never used for money.
- Derived amounts follow the global rounding policy in R9.
- Customer-facing examples in this document (e.g. "20,000 EGP") are expressed in major units for readability only.

### R6 — Wishlist purchase reminders (FINAL)
- Wishlist purchase reminders are explicit background work, separate from restock `Notify Me` (Q51, Audit Correction 8).
- They are marketing-style messages and are sent only where the customer has valid marketing consent for the channel (Q59, Audit Corrections 8 and 9).
- Cadence: **one reminder every 3 days**, **maximum 3 reminders per wishlist item**.
- Reminders for a wishlist item stop when any of the following occurs:
  - the item is purchased;
  - the item is removed from the wishlist;
  - the item becomes unavailable or archived;
  - the customer no longer has valid marketing consent for that channel.
- The system tracks, per wishlist item, the last reminder sent, the reminder count, and the stop reason (Audit Correction 8).
- Ledger: "Closure & Audit Decisions" — R6.

### R7 — Customer-caused opened/used return resolution (FINAL)
- When inspection establishes customer-caused opening, use, or damage (Q98), the resolution is one of:
  1. Return the product to the customer with no refund; or
  2. BeautyFits keeps the product and refunds **25% of the eligible amount actually paid for the affected item quantity** to the BeautyFits Wallet.
- 25% is a policy/configuration value, not hard-coded business logic; changing it is a critical setting subject to Owner/Admin approval (Q180, Q181).
- The amount is rounded per R9.
- This resolution is a human-resolved exception to automatic refund (Q97). The chosen resolution and the deduction are recorded in the audit trail.
- Ledger: "Closure & Audit Decisions" — R7.

### R8 — Current repository state
- The repository currently contains a Next.js starter project, not a completed BeautyFits website. References to "the existing website/frontend" mean the Next.js application in this repository.
- The Next.js app stays at the repository root; it is not moved into an `apps/web` monorepo until a task explicitly requires it.

### R9 — Financial rounding (FINAL)
- One global money rounding policy applies everywhere.
- All monetary storage and transport remain integer EGP minor units (piastres).
- Derived monetary calculations are performed with exact decimal/rational arithmetic (never floating point).
- Final monetary results are rounded to the nearest piastre using **HALF-UP** rounding.
- The same rule applies to percentage discounts, tax amounts, partial refunds (including R7), and weighted-average-cost derived amounts.
- Ledger: "Closure & Audit Decisions" — R9.

### R10 — Phone COD confirmation event (FINAL)
- The COD confirmation channel is WhatsApp or Phone according to availability; SMS may be added later (Q18, Q24).
- Confirmation source recorded on the order (MVP):
  - **WhatsApp secure-link confirmation** → `cod_confirmation_source = WHATSAPP`.
  - **Phone confirmation** → `cod_confirmation_source = PHONE`, plus the staff actor who recorded it. An authorized staff member (`RECORD_COD_CONFIRMATION`) records the event via `POST /admin/orders/{orderId}/record-phone-confirmation`; the event is audited.
  - **SMS** is a future channel, not part of the MVP.
  - No separate `SECURE_LINK` source is needed in the MVP; the secure link belongs to the WhatsApp channel.
- In every case the System then automatically transitions `Pending Confirmation → New` (R1). There is no manual staff transition directly from `Pending Confirmation` to `New`.
- Ledger: "Closure & Audit Decisions" — R10.

### R11 — Cancellation window (FINAL)
- Customer/order cancellation is allowed while the carrier has **not** physically received the shipment, i.e. in these Order statuses: `Pending Confirmation`, `New`, `Confirmed`, `Preparing`, `Ready for Shipment` (Q10, Q33, Q87).
- Cancellation releases reserved stock and any reserved wallet amount (Q28, Audit Correction 5).
- After carrier pickup there is no direct cancellation. A Shipping Cancellation Request is recorded on the Shipment, and the Order remains `Shipped` until the return process is completed (R3).
- Ledger: "Closure & Audit Decisions" — R11.

### R12 — Restock subscription route (FINAL)
- Restock `Notify Me` subscriptions are per Product Variant, because the Variant is the canonical sellable unit (C6).
- API route: `POST /variants/{variantId}/restock-subscription` (and `DELETE` on the same path to cancel).
- Ledger: "Closure & Audit Decisions" — R12.

## v1.2 TASK-002A Closure Decisions

Product-owner decisions made on 2026-09-30 during TASK-002A (`docs/tasks/TASK-002A-docs-closure.md`, decisions D-01 to D-07). D-05 to D-07 were delegated by the owner to the recommended option; they can be revised later like any other decision.

### R13 — Customer login (D-01)
- Customers log in with **email + password**.
- Phone remains required, normalized and unique per customer; it stays the primary business identifier (Q41) for COD confirmation and guest-order linking. Email remains verified by OTP at registration (Q42) and is used for recovery.

### R14 — Languages (D-02)
- Website, mobile app and dashboard support **Arabic and English**; Arabic is displayed right-to-left.
- Customer-facing catalog text (product, variant, brand and category names, descriptions) and customer notification templates exist in both languages.

### R15 — Shared email between customer and employee accounts (D-03)
- The same email address may hold one customer account and one employee account. The two remain separate identities with separate logins and sessions.

### R16 — Guest orders after checkout (D-04)
- Guests cannot view, track or cancel orders online. They contact support, or create an account and link eligible guest orders through the OTP claim flow (Q43, Q44).
- The WhatsApp COD confirmation link (R10) still works for guest orders, but it only confirms the order; it does not show tracking or allow cancellation. Confirmed by the owner during TASK-002A review.

### R17 — Default roles and permission catalog (D-05)
- The canonical permission codes and the default editable roles are defined in `docs/security/permission-catalog.md`.

### R18 — Manager limits (D-06)
- By default no Manager-level role may publish products, approve returns, complete returns (trigger refunds) or perform manual refunds; these stay with Owner/Admin unless the Owner/Admin grants them explicitly.

### R19 — Order status approvals in v1 (D-07)
- In v1 no order status transition requires an approval request; order actions are controlled by their permissions (Q76 allows, but does not require, pending approval).
- The approval-request mechanism (Audit Correction 7) is used in v1 for purchase orders, over-delivery extras, marketing campaigns and critical settings.

## v1.2 TASK-005 Closure Decisions

Product-owner decisions made on 2026-09-30 during TASK-005 (`docs/tasks/TASK-005-cross-cutting-foundations.md`). Recorded in `docs/decisions/business-rules-ledger.xlsx`, "Closure & Audit Decisions" worksheet.

### R20 — Business timezone
- The business timezone is **Africa/Cairo**, including daylight saving time when Egypt applies it.
- Timestamps are still stored in UTC (Database Design §1 principle 10).
- Calendar-day concepts use Africa/Cairo: analytics Today / Yesterday / ranges (Q149) and the return window (R21).

### R21 — Day counting
- **Return window (Q17):** a return may be requested until the end of the **14th calendar day after the delivery date**, in Africa/Cairo. The delivery day is day 0.
- **COD confirmation maximum (Q25):** an **exact elapsed duration** of at most **72 hours** from order creation. The configurable timeout can never exceed 72 hours.

### R22 — HALF-UP on negative amounts
- HALF-UP rounding (R9) rounds ties **away from zero** for negative amounts too: `2.5 → 3`, `-2.5 → -3`.

## Key non-negotiables
- Backend is authoritative for price, stock, discount, shipping, permissions and order state.
- Checkout core DB changes are atomic; external notifications happen after commit.
- Order creation is idempotent.
- Historical order/audit/invoice records are not rewritten.
- Products with history are archived, not hard-deleted.
- Marketing requires explicit opt-in and is separate from transactional notifications.
- Sensitive employee/customer actions are permission-controlled and audited.

## Version 1.1 Change Log
- Added C1–C6 closure decisions.
- Separated Order, Shipment and Return state concerns.
- Added Order Modification re-confirmation rule.
- Added supplier financial traceability and persistent approval requests.
- Clarified wallet reservation vs refund semantics.
- Clarified marketing fallback consent and wishlist reminder behavior.
- TASK-001 reconciliation (R1–R8): automatic Pending Confirmation → New, Order/Shipment status separation, shipping cancellation request as a shipment-level request, Ready for Shipment transition, integer minor-unit money, wishlist reminders, customer-caused 25% Wallet refund, current repository state.
- TASK-001 final closure decisions (R6, R7, R9–R12): wishlist reminder cadence and stop conditions, customer-caused 25% refund basis, HALF-UP financial rounding, phone COD confirmation event, cancellation window, variant-level restock subscription route.
- TASK-002A closure decisions (R13–R19): email login, Arabic + English, shared customer/employee email, no online guest order tracking, permission catalog and default roles, Manager limits, no order-status approvals in v1. Audit Correction 1 shipment lifecycle aligned with R2.
- TASK-005 closure decisions (R20–R22): Africa/Cairo business timezone, calendar-day return window and 72-hour elapsed COD maximum, HALF-UP ties away from zero for negative amounts.
