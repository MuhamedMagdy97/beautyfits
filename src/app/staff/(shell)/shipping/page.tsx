"use client";

import Link from "next/link";
import { useState } from "react";
import type { OrderListItemView } from "@/server/modules/orders/orders-service";
import {
  Button,
  formatDate,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  Select,
  StatusBadge,
  Table,
  useApiData,
} from "../../_components/catalog-ui";
import { submit } from "../../_components/ui";
import { field } from "../../_lib/forms";
import { formatPiastres } from "../../_lib/money";
import { usePurchasingT } from "../../_lib/purchasing-i18n";
import { ShippingTabs } from "./tabs";

const PAGE_SIZE = 25;
/** Order states around the carrier handoff; shipments exist from SHIPPED on. */
const STATUSES = [
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_SHIPMENT",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
];

/**
 * Shipments queue (TASK-034..036). There is no shipment list endpoint, so the
 * queue is the order list by status; each order opens its shipping screen.
 */
export default function ShippingPage() {
  return (
    <>
      <ShippingTabs />
      <Guard anyOf={["ORDERS_VIEW"]}>
        <Shipments />
      </Guard>
    </>
  );
}

function Shipments() {
  const { c, p } = usePurchasingT();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("READY_FOR_SHIPMENT");
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) query.set("search", search);
  if (status) query.set("status", status);
  const { state, reload } = useApiData<OrderListItemView[]>(`/api/v1/admin/orders?${query}`);

  return (
    <>
      <PageTitle>{p.shipments}</PageTitle>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={submit((form) => {
          setSearch(field(form, "search") ?? "");
          setStatus(field(form, "status") ?? "");
          setPage(1);
        })}
      >
        <div className="min-w-48 flex-1">
          <Input
            label={c.search}
            name="search"
            type="search"
            placeholder={p.searchOrders}
            defaultValue={search}
          />
        </div>
        <Select label={p.orderStatus} name="status" defaultValue={status}>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {c.statuses[value]}
            </option>
          ))}
        </Select>
        <Button type="submit">{c.search}</Button>
      </form>
      <Loaded load={state} reload={reload}>
        {(orders) => (
          <>
            <Table head={[p.order, p.customer, p.orderStatus, p.total, p.createdAt]}>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-3 py-2" dir="ltr">
                    <Link
                      href={`/staff/shipping/orders/${order.id}`}
                      className="font-semibold text-plum hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{order.customer?.fullName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-3 py-2">{formatPiastres(order.total)}</td>
                  <td className="px-3 py-2">{formatDate(order.createdAt)}</td>
                </tr>
              ))}
            </Table>
            <Pager page={page} count={orders.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}
