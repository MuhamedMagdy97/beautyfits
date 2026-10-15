"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminCustomerListItem } from "@/server/modules/customers/admin-customers-service";
import {
  Button,
  formatDate,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  Table,
  useApiData,
  useCan,
} from "../../_components/catalog-ui";
import { submit } from "../../_components/ui";
import { field } from "../../_lib/forms";
import { accountLabel, useOrdersT } from "../../_lib/orders-i18n";

const PAGE_SIZE = 25;

/** Customers (TASK-054): search by name and, with contact access, by phone. */
export default function CustomersPage() {
  return (
    <Guard anyOf={["CUSTOMER_VIEW"]}>
      <Customers />
    </Guard>
  );
}

function Customers() {
  const { c, o } = useOrdersT();
  const can = useCan();
  const contact = can("VIEW_CUSTOMER_CONTACT");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "", phone: "" });
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const { state, reload } = useApiData<AdminCustomerListItem[]>(`/api/v1/admin/customers?${query}`);

  return (
    <>
      <PageTitle>{o.customers}</PageTitle>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={submit((form) => {
          setFilters({ search: field(form, "search") ?? "", phone: field(form, "phone") ?? "" });
          setPage(1);
        })}
      >
        <div className="min-w-48 flex-1">
          <Input
            label={c.search}
            name="search"
            type="search"
            placeholder={o.searchCustomers}
            defaultValue={filters.search}
          />
        </div>
        {contact ? (
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
        <Button type="submit">{c.search}</Button>
      </form>
      <Loaded load={state} reload={reload}>
        {(customers) => (
          <>
            <Table
              head={[o.name, ...(contact ? [o.phone] : []), o.accountStatus, o.orderCount, o.since]}
            >
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/staff/customers/${customer.id}`}
                      className="font-semibold text-plum hover:underline"
                    >
                      {customer.fullName}
                    </Link>
                  </td>
                  {contact ? (
                    <td className="px-3 py-2" dir="ltr">
                      {customer.phone}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">{accountLabel(o, customer)}</td>
                  <td className="px-3 py-2">{customer.orderCount}</td>
                  <td className="px-3 py-2">{formatDate(customer.createdAt)}</td>
                </tr>
              ))}
            </Table>
            <Pager page={page} count={customers.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}
