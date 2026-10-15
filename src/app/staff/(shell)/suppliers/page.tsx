"use client";

import Link from "next/link";
import { useState } from "react";
import type { SupplierView } from "@/server/modules/suppliers/suppliers-service";
import {
  Button,
  Card,
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
import { staffApi, staffPost } from "../../_lib/api";
import { field } from "../../_lib/forms";
import { usePurchasingT } from "../../_lib/purchasing-i18n";

const PAGE_SIZE = 25;

/** Suppliers: list, search, create, edit, deactivate / reactivate (TASK-021, API §21). */
export default function SuppliersPage() {
  return (
    <Guard anyOf={["SUPPLIER_VIEW"]}>
      <Suppliers />
    </Guard>
  );
}

function Suppliers() {
  const { c, p } = usePurchasingT();
  const can = useCan();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SupplierView | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) query.set("search", search);
  if (status) query.set("status", status);
  const { state, reload } = useApiData<SupplierView[]>(`/api/v1/admin/suppliers?${query}`);
  const { run, pending, notice } = useAction(reload);
  const manage = can("SUPPLIER_MANAGE");

  return (
    <>
      <PageTitle
        aside={
          manage ? (
            <Button onClick={() => setCreating((open) => !open)}>{p.newSupplier}</Button>
          ) : null
        }
      >
        {p.suppliers}
      </PageTitle>
      {creating ? (
        <SupplierForm
          title={p.newSupplier}
          onCancel={() => setCreating(false)}
          onSave={(body) =>
            staffPost("/api/v1/admin/suppliers", body).then(() => {
              setCreating(false);
              reload();
            })
          }
        />
      ) : null}
      {editing ? (
        <SupplierForm
          key={editing.id}
          title={editing.name}
          supplier={editing}
          onCancel={() => setEditing(null)}
          onSave={(body) =>
            staffApi(`/api/v1/admin/suppliers/${editing.id}`, {
              method: "PATCH",
              body: JSON.stringify(body),
            }).then(() => {
              setEditing(null);
              reload();
            })
          }
        />
      ) : null}
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
            placeholder={p.searchSuppliers}
            defaultValue={search}
          />
        </div>
        <Select label={c.status} name="status" defaultValue={status}>
          <option value="">{c.allStatuses}</option>
          <option value="ACTIVE">{c.statuses.ACTIVE}</option>
          <option value="INACTIVE">{c.statuses.INACTIVE}</option>
        </Select>
        <Button type="submit">{c.search}</Button>
      </form>
      {notice}
      <Loaded load={state} reload={reload}>
        {(suppliers) => (
          <>
            <Table head={[c.name, p.phone, p.email, c.status, p.actions]}>
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : null}
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td className="px-3 py-2 font-semibold">{supplier.name}</td>
                  <td className="px-3 py-2" dir="ltr">
                    {supplier.phone ?? "—"}
                  </td>
                  <td className="px-3 py-2" dir="ltr">
                    {supplier.email ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={supplier.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {can("SUPPLIER_FINANCE_VIEW") ? (
                        <Link
                          href={`/staff/suppliers/${supplier.id}?${new URLSearchParams({ name: supplier.name })}`}
                          className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-plum hover:bg-velvet-low"
                        >
                          {p.finance}
                        </Link>
                      ) : null}
                      {manage ? (
                        <>
                          <Button variant="plain" onClick={() => setEditing(supplier)}>
                            {c.edit}
                          </Button>
                          <Button
                            variant={supplier.status === "ACTIVE" ? "danger" : "plain"}
                            disabled={pending}
                            onClick={() =>
                              void run(() =>
                                staffApi(`/api/v1/admin/suppliers/${supplier.id}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({
                                    status: supplier.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                                  }),
                                }),
                              )
                            }
                          >
                            {supplier.status === "ACTIVE" ? c.deactivate : c.activate}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            <Pager page={page} count={suppliers.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}

function SupplierForm({
  title,
  supplier,
  onSave,
  onCancel,
}: {
  title: string;
  supplier?: SupplierView;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { c, p } = usePurchasingT();
  const { run, pending, notice } = useAction();
  // On edit a blank field clears the value (null); on create it is left out.
  const blank = supplier ? null : undefined;
  return (
    <Card title={title}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={submit((form) => {
          void run(() =>
            onSave({
              name: field(form, "name"),
              phone: field(form, "phone") ?? blank,
              email: field(form, "email") ?? blank,
              address: field(form, "address") ?? blank,
              notes: field(form, "notes") ?? blank,
            }),
          );
        })}
      >
        <Input label={c.name} name="name" required maxLength={200} defaultValue={supplier?.name} />
        <Input
          label={p.phone}
          name="phone"
          type="tel"
          dir="ltr"
          defaultValue={supplier?.phone ?? ""}
        />
        <Input
          label={p.email}
          name="email"
          type="email"
          dir="ltr"
          defaultValue={supplier?.email ?? ""}
        />
        <Input
          label={p.address}
          name="address"
          maxLength={500}
          defaultValue={supplier?.address ?? ""}
        />
        <div className="sm:col-span-2">
          <TextArea
            label={p.notes}
            name="notes"
            maxLength={2000}
            defaultValue={supplier?.notes ?? ""}
          />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {supplier ? c.save : c.create}
          </Button>
          <Button variant="plain" onClick={onCancel}>
            {c.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
