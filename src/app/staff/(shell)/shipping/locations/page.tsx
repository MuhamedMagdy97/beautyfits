"use client";

import { useState } from "react";
import type { AdminArea, AdminGovernorate } from "@/server/modules/locations/locations-service";
import {
  Button,
  Guard,
  Input,
  Loaded,
  PageTitle,
  StatusBadge,
  useAction,
  useApiData,
  useCan,
} from "../../../_components/catalog-ui";
import { submit } from "../../../_components/ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { field } from "../../../_lib/forms";
import { fill } from "../../../_lib/purchasing-i18n";
import { useLocationsT } from "../../../_lib/locations-i18n";
import { ShippingTabs } from "../tabs";

/**
 * Managed location list (TASK-055A, Business Spec R32, ADR-0030): the 27
 * fixed governorates and their areas. Rename, deactivate / reactivate, add
 * areas. Nothing is deleted.
 */
export default function LocationsPage() {
  return (
    <>
      <ShippingTabs />
      <Guard anyOf={["SHIPPING_VIEW"]}>
        <Locations />
      </Guard>
    </>
  );
}

function Locations() {
  const { l, english } = useLocationsT();
  const manage = useCan()("SHIPPING_MANAGE");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { state, reload } = useApiData<AdminGovernorate[]>("/api/v1/admin/locations");
  const { run, pending, notice } = useAction(reload);
  const save = (path: string, body: Record<string, unknown>) =>
    run(() => staffApi(path, { method: "PATCH", body: JSON.stringify(body) }));

  return (
    <>
      <PageTitle>{l.locations}</PageTitle>
      <p className="mb-4 text-sm text-ink-soft">{l.locationsHint}</p>
      <div className="mb-4 max-w-sm">
        <Input
          label={l.search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {notice}
      <Loaded load={state} reload={reload}>
        {(governorates) => (
          <ul className="space-y-3">
            {governorates
              .filter((g) =>
                `${g.code} ${g.nameAr} ${g.nameEn}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase()),
              )
              .map((governorate) => (
                <li key={governorate.id} className="rounded-xl border border-line bg-white p-4">
                  <Row
                    item={governorate}
                    code={governorate.code}
                    manage={manage}
                    pending={pending}
                    onSave={(body) => save(`/api/v1/admin/governorates/${governorate.id}`, body)}
                    extra={
                      <Button
                        variant="plain"
                        aria-expanded={open === governorate.id}
                        onClick={() => setOpen(open === governorate.id ? null : governorate.id)}
                      >
                        {open === governorate.id ? l.hide : l.show} (
                        {fill(l.areaCount, { n: governorate.areas.length })})
                      </Button>
                    }
                  />
                  {open === governorate.id ? (
                    <div className="mt-4 border-t border-line pt-4">
                      {governorate.areas.length === 0 ? (
                        <p className="text-sm text-ink-soft">{l.noAreas}</p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {[...governorate.areas]
                            .sort((a, b) =>
                              (english ? a.nameEn : a.nameAr).localeCompare(
                                english ? b.nameEn : b.nameAr,
                              ),
                            )
                            .map((area: AdminArea) => (
                              <li key={area.id} className="py-2">
                                <Row
                                  item={area}
                                  manage={manage}
                                  pending={pending}
                                  onSave={(body) => save(`/api/v1/admin/areas/${area.id}`, body)}
                                />
                              </li>
                            ))}
                        </ul>
                      )}
                      {manage ? (
                        <AddArea
                          pending={pending}
                          onAdd={(body) =>
                            run(() =>
                              staffPost(`/api/v1/admin/governorates/${governorate.id}/areas`, body),
                            )
                          }
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </Loaded>
    </>
  );
}

/** One governorate or area: names, status, rename and (de)activate. */
function Row({
  item,
  code,
  manage,
  pending,
  onSave,
  extra,
}: {
  item: { nameAr: string; nameEn: string; status: "ACTIVE" | "INACTIVE" };
  code?: string;
  manage: boolean;
  pending: boolean;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  extra?: React.ReactNode;
}) {
  const { c, l } = useLocationsT();
  const [renaming, setRenaming] = useState(false);
  if (renaming) {
    return (
      <form
        className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={submit((form) => {
          void onSave({ nameAr: field(form, "nameAr"), nameEn: field(form, "nameEn") }).then(
            (ok) => ok && setRenaming(false),
          );
        })}
      >
        <Input label={c.nameAr} name="nameAr" required maxLength={100} defaultValue={item.nameAr} />
        <Input
          label={c.nameEn}
          name="nameEn"
          required
          maxLength={100}
          dir="ltr"
          defaultValue={item.nameEn}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {c.save}
          </Button>
          <Button variant="plain" onClick={() => setRenaming(false)}>
            {c.cancel}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {code ? (
        <span className="text-xs font-semibold text-ink-soft" dir="ltr">
          {code}
        </span>
      ) : null}
      <span className="font-semibold text-ink">{item.nameAr}</span>
      <span className="text-ink-soft" dir="ltr">
        {item.nameEn}
      </span>
      <StatusBadge status={item.status} />
      <div className="ms-auto flex flex-wrap gap-2">
        {extra}
        {manage ? (
          <>
            <Button variant="plain" onClick={() => setRenaming(true)}>
              {l.rename}
            </Button>
            <Button
              variant={item.status === "ACTIVE" ? "danger" : "plain"}
              disabled={pending}
              onClick={() =>
                void onSave({ status: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
              }
            >
              {item.status === "ACTIVE" ? c.deactivate : c.activate}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function AddArea({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const { c, l } = useLocationsT();
  return (
    <form
      className="mt-4 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        const form = new FormData(element);
        void onAdd({ nameAr: field(form, "nameAr"), nameEn: field(form, "nameEn") }).then(
          (ok) => ok && element.reset(),
        );
      }}
    >
      <Input label={c.nameAr} name="nameAr" required maxLength={100} />
      <Input label={c.nameEn} name="nameEn" required maxLength={100} dir="ltr" />
      <Button type="submit" disabled={pending}>
        {l.addArea}
      </Button>
    </form>
  );
}
