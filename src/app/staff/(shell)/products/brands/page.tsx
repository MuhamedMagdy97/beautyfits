"use client";

import { useState } from "react";
import type { BrandView } from "@/server/modules/catalog/taxonomy-service";
import {
  Button,
  Card,
  CatalogTabs,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  StatusBadge,
  Table,
  TextArea,
  useAction,
  useApiData,
  useCan,
  useLocalName,
} from "../../../_components/catalog-ui";
import { submit } from "../../../_components/ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { useCatalogT } from "../../../_lib/catalog-i18n";
import { field } from "../../../_lib/forms";

const PAGE_SIZE = 50;

/** Brands: list, create, edit, deactivate/reactivate (TASK-015). Nothing is deleted. */
export default function BrandsPage() {
  return (
    <Guard anyOf={["PRODUCT_VIEW"]}>
      <Brands />
    </Guard>
  );
}

function Brands() {
  const { c } = useCatalogT();
  const can = useCan();
  const name = useLocalName();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BrandView | "new" | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) query.set("search", search);
  const { state, reload } = useApiData<BrandView[]>(`/api/v1/admin/brands?${query}`);
  const manage = can("TAXONOMY_MANAGE");
  const { run, pending, notice } = useAction(reload);

  return (
    <>
      <CatalogTabs />
      <PageTitle
        aside={
          manage && editing === null ? (
            <Button onClick={() => setEditing("new")}>{c.newBrand}</Button>
          ) : null
        }
      >
        {c.brands}
      </PageTitle>
      {editing !== null ? (
        <BrandForm
          key={editing === "new" ? "new" : editing.id}
          brand={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      {notice}
      <form
        className="mb-4 flex items-end gap-3"
        onSubmit={submit((form) => {
          setSearch(field(form, "search") ?? "");
          setPage(1);
        })}
      >
        <div className="flex-1">
          <Input label={c.search} name="search" type="search" />
        </div>
        <Button type="submit">{c.search}</Button>
      </form>
      <Loaded load={state} reload={reload}>
        {(brands) => (
          <>
            <Table head={[c.name, c.slugColumn, c.status, c.productCount, ""]}>
              {brands.map((brand) => (
                <tr key={brand.id}>
                  <td className="px-3 py-2 font-semibold">{name(brand)}</td>
                  <td className="px-3 py-2" dir="ltr">
                    {brand.slug}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={brand.status} />
                  </td>
                  <td className="px-3 py-2">{brand.productCount}</td>
                  <td className="px-3 py-2 text-end whitespace-nowrap">
                    {manage ? (
                      <span className="inline-flex gap-2">
                        <Button variant="plain" onClick={() => setEditing(brand)}>
                          {c.edit}
                        </Button>
                        <Button
                          variant="plain"
                          disabled={pending}
                          onClick={() =>
                            void run(() =>
                              staffApi(`/api/v1/admin/brands/${brand.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({
                                  status: brand.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                                }),
                              }),
                            )
                          }
                        >
                          {brand.status === "ACTIVE" ? c.deactivate : c.activate}
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
            <Pager page={page} count={brands.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}

function BrandForm({ brand, onDone }: { brand: BrandView | null; onDone: () => void }) {
  const { c } = useCatalogT();
  const { run, pending, notice } = useAction();
  return (
    <Card title={brand ? c.edit : c.newBrand}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={submit((form) => {
          const body = {
            nameAr: field(form, "nameAr"),
            nameEn: field(form, "nameEn"),
            slug: field(form, "slug"),
            descriptionAr: field(form, "descriptionAr") ?? null,
            descriptionEn: field(form, "descriptionEn") ?? null,
          };
          void run(async () => {
            if (brand) {
              await staffApi(`/api/v1/admin/brands/${brand.id}`, {
                method: "PATCH",
                body: JSON.stringify(body),
              });
            } else {
              await staffPost("/api/v1/admin/brands", body);
            }
            onDone();
          });
        })}
      >
        <Input label={c.nameAr} name="nameAr" required dir="rtl" defaultValue={brand?.nameAr} />
        <Input label={c.nameEn} name="nameEn" required dir="ltr" defaultValue={brand?.nameEn} />
        <Input label={c.slug} name="slug" dir="ltr" defaultValue={brand?.slug} />
        <span />
        <TextArea
          label={c.descriptionAr}
          name="descriptionAr"
          dir="rtl"
          defaultValue={brand?.descriptionAr ?? ""}
        />
        <TextArea
          label={c.descriptionEn}
          name="descriptionEn"
          dir="ltr"
          defaultValue={brand?.descriptionEn ?? ""}
        />
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {brand ? c.save : c.create}
          </Button>
          <Button variant="plain" onClick={onDone}>
            {c.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
