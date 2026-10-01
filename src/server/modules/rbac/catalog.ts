/**
 * The permission catalog (docs/security/permission-catalog.md, Business Spec
 * R17). These are the only permission codes the backend knows. Adding one
 * means updating the catalog document, this list and a migration that
 * inserts the `permissions` row (a test checks that the three agree).
 */

export const PERMISSION_GROUPS = [
  "CATALOG",
  "INVENTORY",
  "ORDERS",
  "RETURNS",
  "CUSTOMERS",
  "ADMINISTRATION",
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

interface CatalogEntry {
  code: string;
  group: PermissionGroup;
  description: string;
}

export const PERMISSION_CATALOG = [
  // Catalog & pricing
  {
    code: "PRODUCT_VIEW",
    group: "CATALOG",
    description: "View products/variants in the dashboard",
  },
  { code: "PRODUCT_CREATE", group: "CATALOG", description: "Create products/variants (Draft)" },
  {
    code: "PRODUCT_EDIT",
    group: "CATALOG",
    description: "Edit product/variant content (not price, cost, media)",
  },
  { code: "PRODUCT_PUBLISH", group: "CATALOG", description: "Publish / unpublish" },
  { code: "PRODUCT_ARCHIVE", group: "CATALOG", description: "Archive / disable" },
  { code: "MANAGE_PRODUCT_MEDIA", group: "CATALOG", description: "Upload/remove/order images" },
  { code: "EDIT_PRODUCT_PRICE", group: "CATALOG", description: "Change selling price" },
  {
    code: "VIEW_COST_PRICE",
    group: "CATALOG",
    description: "See purchase cost, weighted average cost",
  },
  { code: "EDIT_COST_PRICE", group: "CATALOG", description: "Edit cost values where allowed" },
  { code: "TAXONOMY_MANAGE", group: "CATALOG", description: "Create/edit categories and brands" },
  {
    code: "REVIEW_MODERATE",
    group: "CATALOG",
    description: "Hide/restore reviews, handle reports",
  },

  // Inventory, purchasing, suppliers
  {
    code: "INVENTORY_VIEW",
    group: "INVENTORY",
    description: "Stock levels, movements, low-stock alerts",
  },
  {
    code: "ADJUST_INVENTORY",
    group: "INVENTORY",
    description: "Manual stock adjustment (reason required)",
  },
  { code: "SUPPLIER_VIEW", group: "INVENTORY", description: "View suppliers" },
  { code: "SUPPLIER_MANAGE", group: "INVENTORY", description: "Edit suppliers" },
  { code: "PURCHASE_VIEW", group: "INVENTORY", description: "View purchase orders" },
  {
    code: "PURCHASE_CREATE",
    group: "INVENTORY",
    description: "Draft and submit purchase orders",
  },
  {
    code: "PURCHASE_APPROVE",
    group: "INVENTORY",
    description: "Approve purchase orders and over-delivery extras",
  },
  {
    code: "RECEIVE_PURCHASE",
    group: "INVENTORY",
    description: "Record goods receipts and inspection",
  },
  { code: "SUPPLIER_RETURN_MANAGE", group: "INVENTORY", description: "Create supplier returns" },
  {
    code: "SUPPLIER_FINANCE_VIEW",
    group: "INVENTORY",
    description: "Supplier ledger and balances",
  },
  {
    code: "SUPPLIER_PAYMENT_MANAGE",
    group: "INVENTORY",
    description: "Record invoices, payments, credits",
  },

  // Orders & shipping
  { code: "ORDERS_VIEW", group: "ORDERS", description: "View orders" },
  {
    code: "RECORD_COD_CONFIRMATION",
    group: "ORDERS",
    description: "Record phone COD confirmation",
  },
  { code: "CONFIRM_ORDER", group: "ORDERS", description: "New → Confirmed" },
  { code: "START_PREPARING", group: "ORDERS", description: "Confirmed → Preparing" },
  {
    code: "MARK_READY_FOR_SHIPMENT",
    group: "ORDERS",
    description: "Preparing → Ready for Shipment",
  },
  { code: "MARK_AS_SHIPPED", group: "ORDERS", description: "Ready for Shipment → Shipped" },
  { code: "MARK_AS_DELIVERED", group: "ORDERS", description: "Record delivery (manual MVP)" },
  {
    code: "CANCEL_ORDER",
    group: "ORDERS",
    description: "Cancel before carrier pickup (reason required)",
  },
  {
    code: "REQUEST_SHIPPING_CANCELLATION",
    group: "ORDERS",
    description: "Shipping cancellation request after pickup",
  },
  {
    code: "APPROVE_ORDER_STATUS_CHANGE",
    group: "ORDERS",
    description: "Approve pending order status requests",
  },
  { code: "SHIPPING_VIEW", group: "ORDERS", description: "View carriers and shipping rules" },
  { code: "SHIPPING_MANAGE", group: "ORDERS", description: "Edit carriers and shipping rules" },
  { code: "ASSIGN_SHIPPING", group: "ORDERS", description: "Assign/change carrier on an order" },
  {
    code: "MANAGE_SHIPMENT",
    group: "ORDERS",
    description: "Tracking numbers and shipment status updates",
  },
  {
    code: "CONTACT_TASK_MANAGE",
    group: "ORDERS",
    description: "Work customer-contact tasks after failed deliveries",
  },

  // Returns, refunds, wallet
  { code: "RETURNS_VIEW", group: "RETURNS", description: "View returns" },
  { code: "APPROVE_RETURN", group: "RETURNS", description: "Approve / reject return requests" },
  { code: "MANAGE_RETURNS", group: "RETURNS", description: "Arrange return pickup" },
  { code: "RECEIVE_RETURN", group: "RETURNS", description: "Mark returned goods received" },
  { code: "INSPECT_RETURN", group: "RETURNS", description: "Inspect returned items" },
  {
    code: "COMPLETE_RETURN",
    group: "RETURNS",
    description: "Complete return and trigger the eligible wallet refund",
  },
  {
    code: "RESOLVE_CUSTOMER_CAUSED_RETURN",
    group: "RETURNS",
    description: "Choose the R7 outcome (send back / keep + 25%)",
  },
  {
    code: "MANAGE_MANUAL_REFUNDS",
    group: "RETURNS",
    description: "Alternative/manual refund methods",
  },
  { code: "VIEW_WALLET_BALANCE", group: "RETURNS", description: "View a customer's wallet" },
  { code: "ADJUST_WALLET", group: "RETURNS", description: "Manual wallet adjustment" },

  // Customers, marketing, analytics
  {
    code: "CUSTOMER_VIEW",
    group: "CUSTOMERS",
    description: "Customer list and profile (name, order history)",
  },
  {
    code: "VIEW_CUSTOMER_CONTACT",
    group: "CUSTOMERS",
    description: "See customer phone and addresses",
  },
  { code: "DISCOUNT_VIEW", group: "CUSTOMERS", description: "View discounts" },
  { code: "DISCOUNT_MANAGE", group: "CUSTOMERS", description: "Manage discounts" },
  { code: "MARKETING_VIEW", group: "CUSTOMERS", description: "View campaign drafts" },
  { code: "MARKETING_CREATE", group: "CUSTOMERS", description: "Create campaign drafts" },
  { code: "MARKETING_EDIT", group: "CUSTOMERS", description: "Edit campaign drafts" },
  { code: "MARKETING_APPROVE", group: "CUSTOMERS", description: "Final campaign approval" },
  { code: "MARKETING_SEND", group: "CUSTOMERS", description: "Send an approved campaign" },
  { code: "NOTIFICATION_LOG_VIEW", group: "CUSTOMERS", description: "Notification delivery logs" },
  { code: "ANALYTICS_VIEW", group: "CUSTOMERS", description: "Analytics dashboards" },
  { code: "VIEW_PROFIT", group: "CUSTOMERS", description: "Profit and COGS figures" },

  // Administration
  { code: "EMPLOYEE_VIEW", group: "ADMINISTRATION", description: "Employee list" },
  {
    code: "EMPLOYEE_MANAGE",
    group: "ADMINISTRATION",
    description: "Invite, edit, deactivate employees within hierarchy limits",
  },
  { code: "ROLE_VIEW", group: "ADMINISTRATION", description: "View roles" },
  { code: "ROLE_MANAGE", group: "ADMINISTRATION", description: "Create/edit custom roles" },
  {
    code: "APPROVAL_RESOLVE",
    group: "ADMINISTRATION",
    description: "Approve/reject approval requests",
  },
  { code: "SETTINGS_VIEW", group: "ADMINISTRATION", description: "Read settings" },
  { code: "SETTINGS_MANAGE", group: "ADMINISTRATION", description: "Change settings" },
  { code: "VIEW_AUDIT_LOGS", group: "ADMINISTRATION", description: "Audit log viewer" },
] as const satisfies readonly CatalogEntry[];

export type PermissionCode = (typeof PERMISSION_CATALOG)[number]["code"];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_CATALOG.map(
  (entry) => entry.code,
);

const CODE_SET: ReadonlySet<string> = new Set(PERMISSION_CODES);

export function isPermissionCode(value: string): value is PermissionCode {
  return CODE_SET.has(value);
}

/**
 * Permission catalog §2: never granted to the Manager or Employee level, even
 * through a custom role. Only Owner and Admin hold them.
 */
export const OWNER_ADMIN_ONLY_PERMISSIONS: ReadonlySet<PermissionCode> = new Set<PermissionCode>([
  "ADJUST_WALLET",
  "VIEW_AUDIT_LOGS",
  "SETTINGS_MANAGE",
  "MARKETING_APPROVE",
  "PURCHASE_APPROVE",
  "ROLE_MANAGE",
  "APPROVAL_RESOLVE",
  "APPROVE_ORDER_STATUS_CHANGE",
]);
