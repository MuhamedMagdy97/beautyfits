# BeautyFits — Permission Catalog & Default Roles

**Status:** Approved v1.0 — TASK-002A, owner decisions D-05 to D-07 (2026-09-30); Business Spec R17–R19.

This is the canonical list of permission codes. The API contract and all code must use only these codes. Adding a permission requires updating this file.

## How authorization works (existing rules)
- Every staff member has a **level**: `OWNER`, `ADMIN`, `MANAGER`, `EMPLOYEE` (DB §4) and one or more **roles**. A role is a named set of **permissions** (Q66, Q67).
- The backend checks permissions on every request; UI hiding is not security (Architecture §6).
- Owner has full access. Admin has everything except ownership transfer (User Flows §2).
- Owner/Admin create Managers and Employees; Managers create Employees only and cannot grant permissions they do not hold; Employees cannot assign roles (Q65).
- Custom roles are created by Owner/Admin (User Flows §17.1).

Enforcement (TASK-012, ADR-0016): the codes are mirrored in `src/server/modules/rbac/catalog.ts` and the `permissions` table (tests keep the three in sync); endpoints check them with `requirePermission`.

Legend for the "Source" column: **Q/R/API/UF** = already in the documents; **NEW** = proposed name for a permission the documents require but never named.

## 1. Permission catalog

### Catalog & pricing
| Code | Allows | Source |
|---|---|---|
| `PRODUCT_VIEW` | View products/variants in the dashboard | API §13 |
| `PRODUCT_CREATE` | Create products/variants (Draft) | API §13 |
| `PRODUCT_EDIT` | Edit product/variant content (not price, cost, media) | API §13 |
| `PRODUCT_PUBLISH` | Publish / unpublish | API §13 |
| `PRODUCT_ARCHIVE` | Archive / disable | API §13 |
| `MANAGE_PRODUCT_MEDIA` | Upload/remove/order images | Q175 |
| `EDIT_PRODUCT_PRICE` | Change selling price | Q73 |
| `VIEW_COST_PRICE` | See purchase cost, weighted average cost | UF §17.2, Q74 |
| `EDIT_COST_PRICE` | Edit cost values where allowed | UF §17.2 |
| `TAXONOMY_MANAGE` | Create/edit categories and brands | NEW |
| `REVIEW_MODERATE` | Hide/restore reviews, handle reports | NEW (Q174) |

### Inventory, purchasing, suppliers
| Code | Allows | Source |
|---|---|---|
| `INVENTORY_VIEW` | Stock levels, movements, low-stock alerts | API §22 |
| `ADJUST_INVENTORY` | Manual stock adjustment (reason required) | Q71 |
| `SUPPLIER_VIEW` / `SUPPLIER_MANAGE` | View / edit suppliers | API §21 |
| `PURCHASE_VIEW` / `PURCHASE_CREATE` | View / draft and submit purchase orders | API §21 |
| `PURCHASE_APPROVE` | Approve purchase orders and over-delivery extras | NEW (Q113, Q116) |
| `RECEIVE_PURCHASE` | Record goods receipts and inspection | API §21, Q114 |
| `SUPPLIER_RETURN_MANAGE` | Create supplier returns | API §21 |
| `SUPPLIER_FINANCE_VIEW` | Supplier ledger and balances | NEW (API amendments) |
| `SUPPLIER_PAYMENT_MANAGE` | Record invoices, payments, credits | NEW (API amendments) |

### Orders & shipping
| Code | Allows | Source |
|---|---|---|
| `ORDERS_VIEW` | View orders | API §15 |
| `RECORD_COD_CONFIRMATION` | Record phone COD confirmation | R10 |
| `CONFIRM_ORDER` | New → Confirmed | Q82 |
| `START_PREPARING` | Confirmed → Preparing | Q83 |
| `MARK_READY_FOR_SHIPMENT` | Preparing → Ready for Shipment | R4 |
| `MARK_AS_SHIPPED` | Ready for Shipment → Shipped | Q84 |
| `MARK_AS_DELIVERED` | Record delivery (manual MVP) | API §15 |
| `CANCEL_ORDER` | Cancel before carrier pickup (reason required) | Q86 |
| `REQUEST_SHIPPING_CANCELLATION` | Shipping cancellation request after pickup | Q88 |
| `APPROVE_ORDER_STATUS_CHANGE` | Approve pending order status requests | API §15, Q76 |
| `SHIPPING_VIEW` / `SHIPPING_MANAGE` | View / edit carriers and shipping rules | API §16 |
| `ASSIGN_SHIPPING` | Assign/change carrier on an order | API §16, Q126 |
| `MANAGE_SHIPMENT` | Tracking numbers and shipment status updates | API §16 |
| `CONTACT_TASK_MANAGE` | Work customer-contact tasks after failed deliveries | NEW (Q129) |

### Returns, refunds, wallet
| Code | Allows | Source |
|---|---|---|
| `RETURNS_VIEW` | View returns | API §17 |
| `APPROVE_RETURN` | Approve / reject return requests | API §17 |
| `MANAGE_RETURNS` | Arrange return pickup | API §17 |
| `RECEIVE_RETURN` | Mark returned goods received | API §17 |
| `INSPECT_RETURN` | Inspect returned items | API §17, Q94 |
| `COMPLETE_RETURN` | Complete return and trigger the eligible wallet refund | API §17, Q97 |
| `RESOLVE_CUSTOMER_CAUSED_RETURN` | Choose the R7 outcome (send back / keep + 25%) | NEW (R7) |
| `MANAGE_MANUAL_REFUNDS` | Alternative/manual refund methods | Q77 |
| `VIEW_WALLET_BALANCE` | View a customer's wallet | API §18 |
| `ADJUST_WALLET` | Manual wallet adjustment | Q78 |

### Customers, marketing, analytics
| Code | Allows | Source |
|---|---|---|
| `CUSTOMER_VIEW` | Customer list and profile (name, order history) | NEW |
| `VIEW_CUSTOMER_CONTACT` | See customer phone and addresses | NEW (Q80) |
| `DISCOUNT_VIEW` / `DISCOUNT_MANAGE` | View / manage discounts | API §23 |
| `MARKETING_VIEW` / `MARKETING_CREATE` / `MARKETING_EDIT` | Campaign drafts | API §24 |
| `MARKETING_APPROVE` | Final campaign approval | NEW (Q142) |
| `MARKETING_SEND` | Send an approved campaign | API §24 |
| `NOTIFICATION_LOG_VIEW` | Notification delivery logs | NEW (TASK-056) |
| `ANALYTICS_VIEW` | Analytics dashboards | API §27 |
| `VIEW_PROFIT` | Profit and COGS figures (replaces `ANALYTICS_VIEW_PROFIT`) | UF §17.2 |

### Administration
| Code | Allows | Source |
|---|---|---|
| `EMPLOYEE_VIEW` | Employee list | NEW (API §25 "Employee management") |
| `EMPLOYEE_MANAGE` | Invite, edit, deactivate employees within hierarchy limits | NEW (Q64, Q65) |
| `ROLE_VIEW` | View roles | API §25 |
| `ROLE_MANAGE` | Create/edit custom roles | NEW (Q66, UF §17.1) |
| `APPROVAL_RESOLVE` | Approve/reject approval requests | NEW (Audit Correction 7) |
| `SETTINGS_VIEW` / `SETTINGS_MANAGE` | Read / change settings | NEW (Q179) |
| `VIEW_AUDIT_LOGS` | Audit log viewer | Q79 |

## 2. Permissions reserved for Owner/Admin
These are never granted to Manager or Employee levels, even through a custom role, because the documents restrict them to Owner/Admin:

`ADJUST_WALLET` (Q78), `VIEW_AUDIT_LOGS` (Q79), `SETTINGS_MANAGE` (Q179), `MARKETING_APPROVE` (Q142), `PURCHASE_APPROVE` (Q113/Q116, API §21), `ROLE_MANAGE` (UF §17.1), `APPROVAL_RESOLVE` (UF §17.3), `APPROVE_ORDER_STATUS_CHANGE` (Q76).

## 3. Default roles (approved, D-05)
Owner and Admin roles are system roles with every permission. The roles below are editable templates seeded by TASK-004; they are a starting point, not business rules. Role names come from the business spec where it names them.

| Role (typical level) | Permissions | Where the role name comes from |
|---|---|---|
| **Inventory Manager** (Manager) | PRODUCT_VIEW, INVENTORY_VIEW, ADJUST_INVENTORY, VIEW_COST_PRICE, EDIT_COST_PRICE, SUPPLIER_VIEW, PURCHASE_VIEW, ANALYTICS_VIEW | Q68, Q74 |
| **Purchasing Manager** (Manager) | SUPPLIER_VIEW, SUPPLIER_MANAGE, PURCHASE_VIEW, PURCHASE_CREATE, SUPPLIER_RETURN_MANAGE, SUPPLIER_FINANCE_VIEW, INVENTORY_VIEW, PRODUCT_VIEW | Q112 |
| **Warehouse Manager** (Manager) | INVENTORY_VIEW, RECEIVE_PURCHASE, PURCHASE_VIEW, ORDERS_VIEW, START_PREPARING, MARK_READY_FOR_SHIPMENT, MARK_AS_SHIPPED, RETURNS_VIEW, RECEIVE_RETURN, INSPECT_RETURN, EMPLOYEE_VIEW | Q114 |
| **Warehouse / Receiving Employee** (Employee) | INVENTORY_VIEW, RECEIVE_PURCHASE, ORDERS_VIEW, START_PREPARING, MARK_READY_FOR_SHIPMENT, RETURNS_VIEW, RECEIVE_RETURN, INSPECT_RETURN | Q114, UF §2 |
| **Order Operations / Customer Service** (Employee) | ORDERS_VIEW, RECORD_COD_CONFIRMATION, CONFIRM_ORDER, CANCEL_ORDER, CUSTOMER_VIEW, VIEW_CUSTOMER_CONTACT, SHIPPING_VIEW, ASSIGN_SHIPPING, MANAGE_SHIPMENT, MARK_AS_DELIVERED, REQUEST_SHIPPING_CANCELLATION, CONTACT_TASK_MANAGE, RETURNS_VIEW | NEW role name (no name in documents) |
| **Catalog Editor** (Employee) | PRODUCT_VIEW, PRODUCT_CREATE, PRODUCT_EDIT, MANAGE_PRODUCT_MEDIA, TAXONOMY_MANAGE | NEW role name |
| **Marketing Manager** (Manager) | MARKETING_VIEW, MARKETING_CREATE, MARKETING_EDIT, MARKETING_SEND, DISCOUNT_VIEW, DISCOUNT_MANAGE, ANALYTICS_VIEW, PRODUCT_VIEW, REVIEW_MODERATE | UF §16.4 |

Not included in any default role (Owner/Admin grant explicitly): PRODUCT_PUBLISH, PRODUCT_ARCHIVE, EDIT_PRODUCT_PRICE, APPROVE_RETURN, COMPLETE_RETURN, RESOLVE_CUSTOMER_CAUSED_RETURN, MANAGE_MANUAL_REFUNDS, VIEW_WALLET_BALANCE, VIEW_PROFIT, SHIPPING_MANAGE, SUPPLIER_PAYMENT_MANAGE, EMPLOYEE_MANAGE, NOTIFICATION_LOG_VIEW.

## 4. Decisions
- **D-05:** The default roles above are approved as editable templates (seeded by TASK-004).
- **D-06:** No Manager-level default role may publish products, approve or complete returns, or perform manual refunds; Owner/Admin may grant these explicitly (Business Spec R18).
- **D-07:** In v1 no order status transition requires an approval request (Business Spec R19). `APPROVE_ORDER_STATUS_CHANGE` stays in the catalog for later use; approval requests in v1 cover purchase orders, over-delivery extras, marketing campaigns and critical settings.
