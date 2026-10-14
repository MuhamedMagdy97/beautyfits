"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type {
  InventoryItemView,
  InventoryMovementView,
} from "@/server/modules/inventory/inventory-service";
import {
  Button,
  Card,
  formatDate,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  Select,
  Table,
  useAction,
  useApiData,
  useCan,
  useLocalName,
} from "../../../_components/catalog-ui";
import { staffPost } from "../../../_lib/api";
import { useCatalogT } from "../../../_lib/catalog-i18n";
import { field } from "../../../_lib/forms";

const PAGE_SIZE = 25;
const ADJUST_TYPES = ["MANUAL_ADJUSTMENT", "DAMAGE", "DAMAGE_WRITE_OFF"];

/** One variant's balances, movement history and manual adjustment (TASK-019). */
export default function InventoryItemPage() {
  return (
    <Guard anyOf={["INVENTORY_VIEW"]}>
      <InventoryItem />
    </Guard>
  );
}

function InventoryItem() {
  const { c } = useCatalogT();
  const can = useCan();
  const name = useLocalName();
  const { variantId } = useParams<{ variantId: string }>();
  const [page, setPage] = useState(1);
  const item = useApiData<InventoryItemView>(`/api/v1/admin/inventory/${variantId}`);
  const movements = useApiData<InventoryMovementView[]>(
    `/api/v1/admin/inventory/${variantId}/movements?page=${page}&pageSize=${PAGE_SIZE}`,
  );
  const reloadAll = () => {
    item.reload();
    movements.reload();
  };

  return (
    <Loaded load={item.state} reload={item.reload}>
      {(inventory) => (
        <>
          <Link href="/staff/inventory" className="text-sm text-plum hover:underline">
            ← {c.inventory}
          </Link>
          <PageTitle>{`${inventory.sku} — ${name(inventory.product)}`}</PageTitle>
          {can("PRODUCT_VIEW") ? (
            <p className="-mt-4 mb-6 text-sm">
              <Link
                href={`/staff/products/${inventory.product.id}`}
                className="text-plum hover:underline"
              >
                {c.product}
              </Link>
            </p>
          ) : null}
          <div className="mb-6 grid gap-3 sm:grid-cols-4">
            {[
              [c.available, inventory.availableQuantity],
              [c.reserved, inventory.reservedQuantity],
              [c.damaged, inventory.damagedQuantity],
              [c.threshold, inventory.lowStockThreshold ?? "—"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-line bg-white p-4">
                <p className="text-xs text-ink-soft">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>
          {inventory.lowStock ? (
            <p
              className="mb-6 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
              role="status"
            >
              {c.lowStock}
            </p>
          ) : null}
          {can("ADJUST_INVENTORY") ? (
            <AdjustForm variantId={inventory.variantId} onDone={reloadAll} />
          ) : null}
          <Card title={c.movements}>
            <Loaded load={movements.state} reload={movements.reload}>
              {(rows) => (
                <>
                  <Table
                    head={[
                      c.date,
                      c.adjustType,
                      c.available,
                      c.reserved,
                      c.damaged,
                      c.reference,
                      c.reason,
                    ]}
                  >
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-ink-soft">
                          {c.empty}
                        </td>
                      </tr>
                    ) : null}
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                        <td className="px-3 py-2">{c.movementTypes[row.type] ?? row.type}</td>
                        <Delta value={row.availableDelta} />
                        <Delta value={row.reservedDelta} />
                        <Delta value={row.damagedDelta} />
                        <td className="px-3 py-2 text-xs text-ink-soft" dir="ltr">
                          {row.referenceType
                            ? `${row.referenceType} ${row.referenceId ?? ""}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">{row.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </Table>
                  <Pager page={page} count={rows.length} pageSize={PAGE_SIZE} onPage={setPage} />
                </>
              )}
            </Loaded>
          </Card>
        </>
      )}
    </Loaded>
  );
}

function Delta({ value }: { value: number }) {
  return (
    <td className={`px-3 py-2 ${value < 0 ? "text-danger" : ""}`} dir="ltr">
      {value === 0 ? "—" : value > 0 ? `+${value}` : value}
    </td>
  );
}

/**
 * Manual adjustment (Q71): type, quantity and a required reason. The API
 * refuses anything that would make a quantity negative.
 */
function AdjustForm({ variantId, onDone }: { variantId: string; onDone: () => void }) {
  const { c } = useCatalogT();
  const { run, pending, notice } = useAction(onDone);
  return (
    <Card title={c.adjust}>
      {notice}
      <form
        className="grid items-end gap-3 sm:grid-cols-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          const ok = await run(() =>
            staffPost(`/api/v1/admin/inventory/${variantId}/adjust`, {
              type: field(form, "type"),
              quantity: Number(field(form, "quantity")),
              reason: field(form, "reason") ?? "",
            }),
          );
          if (ok) element.reset();
        }}
      >
        <Select label={c.adjustType} name="type" defaultValue={ADJUST_TYPES[0]}>
          {ADJUST_TYPES.map((type) => (
            <option key={type} value={type}>
              {c.movementTypes[type]}
            </option>
          ))}
        </Select>
        <Input label={c.quantity} name="quantity" required inputMode="numeric" dir="ltr" />
        <Input label={c.reasonRequired} name="reason" required maxLength={1000} />
        <Button type="submit" disabled={pending}>
          {c.save}
        </Button>
        <p className="text-xs text-ink-soft sm:col-span-4">{c.quantityHint}</p>
      </form>
    </Card>
  );
}
