"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  useCan,
} from "../../_components/catalog-ui";
import { submit } from "../../_components/ui";
import { field } from "../../_lib/forms";
import { formatPiastres } from "../../_lib/money";
import { useOrdersT } from "../../_lib/orders-i18n";

const PAGE_SIZE = 25;
/** Order states (API "TASK-030 Amendments"). */
const ORDER_STATUSES = [
  "PENDING_CONFIRMATION",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_SHIPMENT",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "EXPIRED",
];

/** Orders queue (TASK-054): status filter, order number and, with contact access, phone. */
export default function OrdersPage() {
  return (
    <Guard anyOf={["ORDERS_VIEW"]}>
      <Orders />
    </Guard>
  );
}

function Orders() {
  const { c, o } = useOrdersT();
  const can = useCan();
  const customerId = useSearchParams().get("customerId");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "", status: "", phone: "" });
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  if (customerId) query.set("customerId", customerId);
  const { state, reload } = useApiData<OrderListItemView[]>(`/api/v1/admin/orders?${query}`);

  return (
    <>
      <PageTitle>{o.orders}</PageTitle>
      {customerId ? (
        <p className="mb-4 text-sm text-ink-soft">
          {o.filteredByCustomer} ·{" "}
          <Link href="/staff/orders" className="text-plum hover:underline">
            {o.clearFilter}
          </Link>
        </p>
      ) : null}
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={submit((form) => {
          setFilters({
            search: field(form, "search") ?? "",
            status: field(form, "status") ?? "",
            phone: field(form, "phone") ?? "",
          });
          setPage(1);
        })}
      >
        <div className="min-w-40 flex-1">
          <Input
            label={c.search}
            name="search"
            type="search"
            dir="ltr"
            placeholder={o.searchOrders}
            defaultValue={filters.search}
          />
        </div>
        {can("VIEW_CUSTOMER_CONTACT") ? (
          <div className="min-w-40">
            <Input
              label={o.phoneFilter}
              name="phone"
              type="tel"
              dir="ltr"
              placeholder={o.phoneHint}
              defaultValue={filters.phone}
            />
          </div>
        ) : null}
        <Select label={c.status} name="status" defaultValue={filters.status}>
          <option value="">{o.allStatuses}</option>
          {ORDER_STATUSES.map((value) => (
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
            <Table head={[o.order, o.customer, c.status, o.items, o.total, o.createdAt]}>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-3 py-2" dir="ltr">
                    <Link
                      href={`/staff/orders/${order.id}`}
                      className="font-semibold text-plum hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {order.customer?.fullName ?? "—"}
                    {order.customer && !order.customer.customerId ? (
                      <span className="text-xs text-ink-soft"> ({o.guest})</span>
                    ) : null}
                    {order.customer?.phone ? (
                      <span className="block text-xs text-ink-soft" dir="ltr">
                        {order.customer.phone}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-3 py-2">{order.itemCount}</td>
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
