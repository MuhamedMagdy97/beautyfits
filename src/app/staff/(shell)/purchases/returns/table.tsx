"use client";

import Link from "next/link";
import type { SupplierReturnView } from "@/server/modules/purchasing/supplier-returns-service";
import { formatDate, StatusBadge, Table } from "../../../_components/catalog-ui";
import { formatPiastres } from "../../../_lib/money";
import { usePurchasingT } from "../../../_lib/purchasing-i18n";

/** Supplier returns as a table, each linking to its screen. */
export function ReturnsTable({ returns }: { returns: SupplierReturnView[] }) {
  const { c, p } = usePurchasingT();
  return (
    <Table head={[p.returnNumber, p.supplier, p.purchase, c.status, p.expected, p.createdAt]}>
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
              href={`/staff/purchases/returns/${item.id}`}
              className="font-semibold text-plum hover:underline"
            >
              {item.returnNumber}
            </Link>
          </td>
          <td className="px-3 py-2">{item.supplier.name}</td>
          <td className="px-3 py-2" dir="ltr">
            {item.purchase.purchaseNumber}
          </td>
          <td className="px-3 py-2">
            <StatusBadge status={item.status} />
          </td>
          <td className="px-3 py-2">{formatPiastres(item.expectedAmount)}</td>
          <td className="px-3 py-2">{formatDate(item.createdAt)}</td>
        </tr>
      ))}
    </Table>
  );
}
