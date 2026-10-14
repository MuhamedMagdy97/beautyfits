"use client";

import Link from "next/link";
import { useState } from "react";
import type { InventoryItemView } from "@/server/modules/inventory/inventory-service";
import {
  Button,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  StatusBadge,
  Table,
  useApiData,
  useLocalName,
} from "../../_components/catalog-ui";
import { submit } from "../../_components/ui";
import { useCatalogT } from "../../_lib/catalog-i18n";
import { field } from "../../_lib/forms";

const PAGE_SIZE = 50;

/** Stock balances and low-stock alerts (API §22, TASK-019). */
export default function InventoryPage() {
  return (
    <Guard anyOf={["INVENTORY_VIEW"]}>
      <Inventory />
    </Guard>
  );
}

function Inventory() {
  const { c } = useCatalogT();
  const name = useLocalName();
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search && !lowOnly) query.set("search", search);
  const { state, reload } = useApiData<InventoryItemView[]>(
    `/api/v1/admin/inventory${lowOnly ? "/low-stock" : ""}?${query}`,
  );

  return (
    <>
      <PageTitle>{c.inventory}</PageTitle>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {[false, true].map((low) => (
          <Button
            key={String(low)}
            variant={lowOnly === low ? "primary" : "plain"}
            aria-pressed={lowOnly === low}
            onClick={() => {
              setLowOnly(low);
              setPage(1);
            }}
          >
            {low ? c.lowStock : c.allStock}
          </Button>
        ))}
        {!lowOnly ? (
          <form
            className="flex flex-1 items-end gap-3"
            onSubmit={submit((form) => {
              setSearch(field(form, "search") ?? "");
              setPage(1);
            })}
          >
            <div className="min-w-48 flex-1">
              <Input
                label={c.search}
                name="search"
                type="search"
                placeholder={c.searchInventory}
                defaultValue={search}
              />
            </div>
            <Button type="submit">{c.search}</Button>
          </form>
        ) : null}
      </div>
      <Loaded load={state} reload={reload}>
        {(items) => (
          <>
            <Table
              head={[c.sku, c.product, c.available, c.reserved, c.damaged, c.threshold, c.status]}
            >
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <tr key={item.variantId} className={item.lowStock ? "bg-danger-soft/40" : ""}>
                  <td className="px-3 py-2" dir="ltr">
                    <Link
                      href={`/staff/inventory/${item.variantId}`}
                      className="font-semibold text-plum hover:underline"
                    >
                      {item.sku}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {name(item.product)}
                    {item.variantNameAr || item.variantNameEn ? (
                      <span className="block text-xs text-ink-soft">
                        {name({ nameAr: item.variantNameAr, nameEn: item.variantNameEn })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-semibold">{item.availableQuantity}</td>
                  <td className="px-3 py-2">{item.reservedQuantity}</td>
                  <td className="px-3 py-2">{item.damagedQuantity}</td>
                  <td className="px-3 py-2">{item.lowStockThreshold ?? "—"}</td>
                  <td className="px-3 py-2">
                    {item.lowStock ? (
                      <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">
                        {c.lowStock}
                      </span>
                    ) : (
                      <StatusBadge status={item.variantStatus} />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <Pager page={page} count={items.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}
