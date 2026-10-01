import type { PermissionCode } from "@/server/modules/rbac/catalog";

/**
 * Default roles (docs/security/permission-catalog.md §3, owner decision D-05).
 * Editable templates, not system roles (ADR-0016 §4): the bootstrap creates
 * each one once and never changes a role that already exists.
 *
 * Each default role has a fixed id, so the seed is deterministic and a role
 * the Owner renamed is not created a second time under its old name.
 * A unit test keeps this list in sync with the catalog document.
 */
export interface DefaultRole {
  id: string;
  name: string;
  /** The level the role is meant for (informational; roles carry no level). */
  typicalLevel: "MANAGER" | "EMPLOYEE";
  permissions: readonly PermissionCode[];
}

export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    id: "00000000-0000-7000-8000-000000000001",
    name: "Inventory Manager",
    typicalLevel: "MANAGER",
    permissions: [
      "PRODUCT_VIEW",
      "INVENTORY_VIEW",
      "ADJUST_INVENTORY",
      "VIEW_COST_PRICE",
      "EDIT_COST_PRICE",
      "SUPPLIER_VIEW",
      "PURCHASE_VIEW",
      "ANALYTICS_VIEW",
    ],
  },
  {
    id: "00000000-0000-7000-8000-000000000002",
    name: "Purchasing Manager",
    typicalLevel: "MANAGER",
    permissions: [
      "SUPPLIER_VIEW",
      "SUPPLIER_MANAGE",
      "PURCHASE_VIEW",
      "PURCHASE_CREATE",
      "SUPPLIER_RETURN_MANAGE",
      "SUPPLIER_FINANCE_VIEW",
      "INVENTORY_VIEW",
      "PRODUCT_VIEW",
    ],
  },
  {
    id: "00000000-0000-7000-8000-000000000003",
    name: "Warehouse Manager",
    typicalLevel: "MANAGER",
    permissions: [
      "INVENTORY_VIEW",
      "RECEIVE_PURCHASE",
      "PURCHASE_VIEW",
      "ORDERS_VIEW",
      "START_PREPARING",
      "MARK_READY_FOR_SHIPMENT",
      "MARK_AS_SHIPPED",
      "RETURNS_VIEW",
      "RECEIVE_RETURN",
      "INSPECT_RETURN",
      "EMPLOYEE_VIEW",
    ],
  },
  {
    id: "00000000-0000-7000-8000-000000000004",
    name: "Warehouse / Receiving Employee",
    typicalLevel: "EMPLOYEE",
    permissions: [
      "INVENTORY_VIEW",
      "RECEIVE_PURCHASE",
      "ORDERS_VIEW",
      "START_PREPARING",
      "MARK_READY_FOR_SHIPMENT",
      "RETURNS_VIEW",
      "RECEIVE_RETURN",
      "INSPECT_RETURN",
    ],
  },
  {
    id: "00000000-0000-7000-8000-000000000005",
    name: "Order Operations / Customer Service",
    typicalLevel: "EMPLOYEE",
    permissions: [
      "ORDERS_VIEW",
      "RECORD_COD_CONFIRMATION",
      "CONFIRM_ORDER",
      "CANCEL_ORDER",
      "CUSTOMER_VIEW",
      "VIEW_CUSTOMER_CONTACT",
      "SHIPPING_VIEW",
      "ASSIGN_SHIPPING",
      "MANAGE_SHIPMENT",
      "MARK_AS_DELIVERED",
      "REQUEST_SHIPPING_CANCELLATION",
      "CONTACT_TASK_MANAGE",
      "RETURNS_VIEW",
    ],
  },
  {
    id: "00000000-0000-7000-8000-000000000006",
    name: "Catalog Editor",
    typicalLevel: "EMPLOYEE",
    permissions: [
      "PRODUCT_VIEW",
      "PRODUCT_CREATE",
      "PRODUCT_EDIT",
      "MANAGE_PRODUCT_MEDIA",
      "TAXONOMY_MANAGE",
    ],
  },
  {
    id: "00000000-0000-7000-8000-000000000007",
    name: "Marketing Manager",
    typicalLevel: "MANAGER",
    permissions: [
      "MARKETING_VIEW",
      "MARKETING_CREATE",
      "MARKETING_EDIT",
      "MARKETING_SEND",
      "DISCOUNT_VIEW",
      "DISCOUNT_MANAGE",
      "ANALYTICS_VIEW",
      "PRODUCT_VIEW",
      "REVIEW_MODERATE",
    ],
  },
];
