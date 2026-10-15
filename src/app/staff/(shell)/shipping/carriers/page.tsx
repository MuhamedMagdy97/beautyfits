"use client";

import { useState } from "react";
import type { ShippingCompanyView } from "@/server/modules/shipping/shipping-service";
import {
  Button,
  Card,
  Guard,
  Input,
  Loaded,
  PageTitle,
  StatusBadge,
  Table,
  TextArea,
  useAction,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { submit } from "../../../_components/ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { field } from "../../../_lib/forms";
import { usePurchasingT } from "../../../_lib/purchasing-i18n";
import { ShippingTabs } from "../tabs";

/** Shipping companies: list, create, edit, deactivate / reactivate (TASK-027, API §16). */
export default function CarriersPage() {
  return (
    <>
      <ShippingTabs />
      <Guard anyOf={["SHIPPING_VIEW"]}>
        <Carriers />
      </Guard>
    </>
  );
}

function Carriers() {
  const { c, p } = usePurchasingT();
  const can = useCan();
  const manage = can("SHIPPING_MANAGE");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ShippingCompanyView | null>(null);
  const { state, reload } = useApiData<ShippingCompanyView[]>("/api/v1/admin/shipping/companies");
  const { run, pending, notice } = useAction(reload);

  return (
    <>
      <PageTitle
        aside={
          manage ? (
            <Button onClick={() => setCreating((open) => !open)}>{p.newCarrier}</Button>
          ) : null
        }
      >
        {p.carriers}
      </PageTitle>
      {creating ? (
        <CarrierForm
          title={p.newCarrier}
          onCancel={() => setCreating(false)}
          onSave={(body) =>
            staffPost("/api/v1/admin/shipping/companies", body).then(() => {
              setCreating(false);
              reload();
            })
          }
        />
      ) : null}
      {editing ? (
        <CarrierForm
          key={editing.id}
          title={editing.name}
          carrier={editing}
          onCancel={() => setEditing(null)}
          onSave={(body) =>
            staffApi(`/api/v1/admin/shipping/companies/${editing.id}`, {
              method: "PATCH",
              body: JSON.stringify(body),
            }).then(() => {
              setEditing(null);
              reload();
            })
          }
        />
      ) : null}
      {notice}
      <Loaded load={state} reload={reload}>
        {(carriers) => (
          <Table head={[p.code, c.name, p.contactInfo, c.status, manage ? p.actions : ""]}>
            {carriers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">
                  {c.empty}
                </td>
              </tr>
            ) : null}
            {carriers.map((carrier) => (
              <tr key={carrier.id}>
                <td className="px-3 py-2 font-semibold" dir="ltr">
                  {carrier.code}
                </td>
                <td className="px-3 py-2">{carrier.name}</td>
                <td className="px-3 py-2 whitespace-pre-line">{carrier.contactInfo ?? "—"}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={carrier.status} />
                </td>
                <td className="px-3 py-2">
                  {manage ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="plain" onClick={() => setEditing(carrier)}>
                        {c.edit}
                      </Button>
                      <Button
                        variant={carrier.status === "ACTIVE" ? "danger" : "plain"}
                        disabled={pending}
                        onClick={() =>
                          void run(() =>
                            staffApi(`/api/v1/admin/shipping/companies/${carrier.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                status: carrier.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                              }),
                            }),
                          )
                        }
                      >
                        {carrier.status === "ACTIVE" ? c.deactivate : c.activate}
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Loaded>
    </>
  );
}

function CarrierForm({
  title,
  carrier,
  onSave,
  onCancel,
}: {
  title: string;
  carrier?: ShippingCompanyView;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { c, p } = usePurchasingT();
  const { run, pending, notice } = useAction();
  return (
    <Card title={title}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={submit((form) => {
          void run(() =>
            onSave({
              code: field(form, "code"),
              name: field(form, "name"),
              contactInfo: field(form, "contactInfo") ?? null,
            }),
          );
        })}
      >
        <Input
          label={p.code}
          name="code"
          required
          dir="ltr"
          maxLength={32}
          defaultValue={carrier?.code}
        />
        <Input label={c.name} name="name" required maxLength={200} defaultValue={carrier?.name} />
        <div className="sm:col-span-2">
          <TextArea
            label={p.contactInfo}
            name="contactInfo"
            maxLength={1000}
            defaultValue={carrier?.contactInfo ?? ""}
          />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {carrier ? c.save : c.create}
          </Button>
          <Button variant="plain" onClick={onCancel}>
            {c.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
