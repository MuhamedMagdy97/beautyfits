"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  PurchaseSummaryView,
  PurchaseView,
} from "@/server/modules/purchasing/purchase-orders-service";
import type { SupplierView } from "@/server/modules/suppliers/suppliers-service";
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
  StatusBadge,
  Table,
  TextArea,
  useAction,
  useApiData,
  useCan,
} from "../../_components/catalog-ui";
import { submit } from "../../_components/ui";
import { staffPost } from "../../_lib/api";
import { field } from "../../_lib/forms";
import { formatPiastres } from "../../_lib/money";
import { usePurchasingT } from "../../_lib/purchasing-i18n";
import { purchaseItems } from "./lines";
import { PurchasingTabs } from "./tabs";

const PAGE_SIZE = 25;
const STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
];

/** Purchase orders: list, filters and new drafts (TASK-022, API §21). */
export default function PurchasesPage() {
  return (
    <Guard anyOf={["PURCHASE_VIEW", "RECEIVE_PURCHASE"]}>
      <Purchases />
    </Guard>
  );
}

function Purchases() {
  const { c, p } = usePurchasingT();
  const can = useCan();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) query.set("search", search);
  if (status) query.set("status", status);
  const { state, reload } = useApiData<PurchaseSummaryView[]>(`/api/v1/admin/purchases?${query}`);

  return (
    <>
      <PurchasingTabs />
      <PageTitle
        aside={
          can("PURCHASE_CREATE") ? (
            <Button onClick={() => setCreating((open) => !open)}>{p.newPurchase}</Button>
          ) : null
        }
      >
        {p.purchases}
      </PageTitle>
      {creating ? <CreatePurchase onCancel={() => setCreating(false)} /> : null}
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
            placeholder={p.searchPurchases}
            defaultValue={search}
          />
        </div>
        <Select label={c.status} name="status" defaultValue={status}>
          <option value="">{c.allStatuses}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {c.statuses[value]}
            </option>
          ))}
        </Select>
        <Button type="submit">{c.search}</Button>
      </form>
      <Loaded load={state} reload={reload}>
        {(purchases) => (
          <>
            <Table head={[p.purchaseNumber, p.supplier, c.status, p.total, p.createdAt]}>
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td className="px-3 py-2" dir="ltr">
                    <Link
                      href={`/staff/purchases/${purchase.id}`}
                      className="font-semibold text-plum hover:underline"
                    >
                      {purchase.purchaseNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{purchase.supplier.name}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={purchase.status} />
                  </td>
                  <td className="px-3 py-2">{formatPiastres(purchase.orderedTotal) ?? "—"}</td>
                  <td className="px-3 py-2">{formatDate(purchase.createdAt)}</td>
                </tr>
              ))}
            </Table>
            <Pager page={page} count={purchases.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}

function CreatePurchase({ onCancel }: { onCancel: () => void }) {
  const dictionary = usePurchasingT();
  const { c, p } = dictionary;
  const router = useRouter();
  const { run, pending, notice, fail } = useAction();
  // ponytail: first 100 active suppliers (API page maximum); add a supplier search when there are more.
  const suppliers = useApiData<SupplierView[]>(
    "/api/v1/admin/suppliers?status=ACTIVE&pageSize=100",
  );

  return (
    <Card title={p.newPurchase}>
      {notice}
      <form
        className="grid gap-4"
        onSubmit={submit(async (form) => {
          const items = await purchaseItems(String(form.get("lines") ?? ""), dictionary);
          if (typeof items === "string") {
            fail(items);
            return;
          }
          void run(async () => {
            const purchase = await staffPost<PurchaseView>("/api/v1/admin/purchases", {
              supplierId: field(form, "supplierId"),
              notes: field(form, "notes"),
              items,
            });
            router.push(`/staff/purchases/${purchase.id}`);
          });
        })}
      >
        <Select label={p.supplier} name="supplierId" required defaultValue="">
          <option value="" disabled>
            {p.chooseSupplier}
          </option>
          {(suppliers.state.status === "ready" ? suppliers.state.data : []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>
        <TextArea
          label={p.linesLabel}
          name="lines"
          rows={6}
          required
          dir="ltr"
          placeholder={p.linesExample}
        />
        <TextArea label={p.notes} name="notes" maxLength={2000} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {c.create}
          </Button>
          <Button variant="plain" onClick={onCancel}>
            {c.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
