"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { AdminReturnView } from "@/server/modules/returns/returns-service";
import {
  Button,
  formatDate,
  Guard,
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
import { useOrdersT } from "../../_lib/orders-i18n";

const PAGE_SIZE = 25;

/** Returns queue (TASK-054): newest first, by status; `?orderId=` / `?customerId=` narrow it. */
export default function ReturnsPage() {
  return (
    <Guard anyOf={["RETURNS_VIEW"]}>
      <Returns />
    </Guard>
  );
}

function Returns() {
  const { c, o } = useOrdersT();
  const params = useSearchParams();
  const [page, setPage] = useState(1);
  const narrowed = params.has("orderId") || params.has("customerId");
  const [status, setStatus] = useState(narrowed ? "" : "PENDING_APPROVAL");
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) query.set("status", status);
  for (const key of ["orderId", "customerId"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const { state, reload } = useApiData<AdminReturnView[]>(`/api/v1/admin/returns?${query}`);

  return (
    <>
      <PageTitle>{o.returns}</PageTitle>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={submit((form) => {
          setStatus(field(form, "status") ?? "");
          setPage(1);
        })}
      >
        <Select label={c.status} name="status" defaultValue={status}>
          <option value="">{o.allStatuses}</option>
          {Object.entries(o.returnStatuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Button type="submit">{c.apply}</Button>
      </form>
      <Loaded load={state} reload={reload}>
        {(returns) => (
          <>
            <Table head={[o.returnNumber, o.order, o.claimType, c.status, o.items, o.createdAt]}>
              {returns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {returns.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2" dir="ltr">
                    <Link
                      href={`/staff/returns/${item.id}`}
                      className="font-semibold text-plum hover:underline"
                    >
                      {item.returnNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {item.orderNumber}
                  </td>
                  <td className="px-3 py-2">{o.claimTypes[item.claimType] ?? item.claimType}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={item.status} label={o.returnStatuses[item.status]} />
                  </td>
                  <td className="px-3 py-2">
                    {item.items.reduce((sum, line) => sum + line.requestedQuantity, 0)}
                  </td>
                  <td className="px-3 py-2">{formatDate(item.createdAt)}</td>
                </tr>
              ))}
            </Table>
            <Pager page={page} count={returns.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}
