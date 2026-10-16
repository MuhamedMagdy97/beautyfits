"use client";

import { Tabs, useCan } from "../../_components/catalog-ui";
import { useLocationsT } from "../../_lib/locations-i18n";
import { usePurchasingT } from "../../_lib/purchasing-i18n";

/** Shipments / Carriers / Rules / Locations / Contact tasks, each shown with its read permission. */
export function ShippingTabs() {
  const { p } = usePurchasingT();
  const { l } = useLocationsT();
  const can = useCan();
  const tabs = [];
  if (can("ORDERS_VIEW")) tabs.push({ href: "/staff/shipping", label: p.shipments });
  if (can("SHIPPING_VIEW")) {
    tabs.push({ href: "/staff/shipping/carriers", label: p.carriers });
    tabs.push({ href: "/staff/shipping/rules", label: l.rules });
    tabs.push({ href: "/staff/shipping/locations", label: l.locations });
  }
  if (can("CONTACT_TASK_MANAGE")) {
    tabs.push({ href: "/staff/shipping/contact-tasks", label: p.contactTasks });
  }
  return <Tabs label={p.shipping} tabs={tabs} />;
}
