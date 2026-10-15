"use client";

import { Tabs, useCan } from "../../_components/catalog-ui";
import { usePurchasingT } from "../../_lib/purchasing-i18n";

/** Readers of supplier returns (API "TASK-024 Amendments"). */
export const RETURN_READERS = [
  "SUPPLIER_RETURN_MANAGE",
  "SUPPLIER_FINANCE_VIEW",
  "SUPPLIER_PAYMENT_MANAGE",
] as const;

/** Purchase orders / Supplier returns switcher, each shown with its read permission. */
export function PurchasingTabs() {
  const { p } = usePurchasingT();
  const can = useCan();
  const tabs = [];
  if (can("PURCHASE_VIEW") || can("RECEIVE_PURCHASE")) {
    tabs.push({ href: "/staff/purchases", label: p.purchases });
  }
  if (RETURN_READERS.some(can)) {
    tabs.push({ href: "/staff/purchases/returns", label: p.supplierReturns });
  }
  return <Tabs label={p.purchases} tabs={tabs} />;
}
