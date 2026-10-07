import type { PermissionCode } from "@/server/modules/rbac/catalog";

/**
 * Dashboard navigation (TASK-052). Each section is shown when the employee
 * holds at least one of its permissions (the codes the section's read
 * endpoints check). Hiding is cosmetic: the API checks every request.
 *
 * Feature screens (TASK-053..057) add a real route at `/staff/<slug>`; until
 * then `/staff/[section]` shows a placeholder.
 */
export interface NavSection {
  slug: string;
  anyOf: readonly PermissionCode[];
}

export interface NavGroup {
  id: string;
  sections: readonly NavSection[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "catalog",
    sections: [
      { slug: "products", anyOf: ["PRODUCT_VIEW"] },
      { slug: "inventory", anyOf: ["INVENTORY_VIEW"] },
    ],
  },
  {
    id: "sales",
    sections: [
      { slug: "orders", anyOf: ["ORDERS_VIEW"] },
      { slug: "customers", anyOf: ["CUSTOMER_VIEW"] },
      { slug: "returns", anyOf: ["RETURNS_VIEW"] },
      { slug: "wallet", anyOf: ["VIEW_WALLET_BALANCE"] },
      { slug: "shipping", anyOf: ["SHIPPING_VIEW"] },
    ],
  },
  {
    id: "purchasing",
    sections: [
      { slug: "suppliers", anyOf: ["SUPPLIER_VIEW", "SUPPLIER_FINANCE_VIEW"] },
      { slug: "purchases", anyOf: ["PURCHASE_VIEW"] },
    ],
  },
  {
    id: "marketing",
    sections: [
      { slug: "discounts", anyOf: ["DISCOUNT_VIEW"] },
      { slug: "marketing", anyOf: ["MARKETING_VIEW"] },
      { slug: "notifications", anyOf: ["NOTIFICATION_LOG_VIEW"] },
      { slug: "analytics", anyOf: ["ANALYTICS_VIEW"] },
    ],
  },
  {
    id: "administration",
    sections: [
      { slug: "employees", anyOf: ["EMPLOYEE_VIEW"] },
      { slug: "roles", anyOf: ["ROLE_VIEW"] },
      { slug: "approvals", anyOf: ["APPROVAL_RESOLVE"] },
      { slug: "audit-logs", anyOf: ["VIEW_AUDIT_LOGS"] },
      { slug: "settings", anyOf: ["SETTINGS_VIEW"] },
    ],
  },
];

export function canSee(section: NavSection, permissions: readonly string[]): boolean {
  return section.anyOf.some((code) => permissions.includes(code));
}

/** The groups and sections the employee may see; empty groups are dropped. */
export function visibleNav(permissions: readonly string[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    id: group.id,
    sections: group.sections.filter((section) => canSee(section, permissions)),
  })).filter((group) => group.sections.length > 0);
}

export function findSection(slug: string): NavSection | undefined {
  return NAV_GROUPS.flatMap((group) => group.sections).find((section) => section.slug === slug);
}

/**
 * Where to go after signing in: only a dashboard path of this site, never an
 * external URL (open-redirect protection).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (
    typeof next === "string" &&
    /^\/staff(\/|$|\?)/.test(next) &&
    !next.includes("\\") &&
    !next.startsWith("/staff/login")
  ) {
    return next;
  }
  return "/staff";
}
