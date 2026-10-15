"use client";

import { Tabs, useCan } from "../../_components/catalog-ui";
import { usePurchasingT } from "../../_lib/purchasing-i18n";

/** Shipments / Carriers / Contact tasks, each shown with its read permission. */
export function ShippingTabs() {
  const { p } = usePurchasingT();
  const can = useCan();
  const tabs = [];
  if (can("ORDERS_VIEW")) tabs.push({ href: "/staff/shipping", label: p.shipments });
  if (can("SHIPPING_VIEW")) tabs.push({ href: "/staff/shipping/carriers", label: p.carriers });
  if (can("CONTACT_TASK_MANAGE")) {
    tabs.push({ href: "/staff/shipping/contact-tasks", label: p.contactTasks });
  }
  return <Tabs label={p.shipping} tabs={tabs} />;
}
