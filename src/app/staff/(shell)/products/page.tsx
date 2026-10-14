"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProductSummaryView, ProductView } from "@/server/modules/catalog/products-service";
import {
  Button,
  Card,
  CatalogTabs,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Pager,
  Select,
  StatusBadge,
  Table,
  useAction,
  useApiData,
  useCan,
  useLocalName,
} from "../../_components/catalog-ui";
import { submit } from "../../_components/ui";
import { staffPost } from "../../_lib/api";
import { useCatalogT } from "../../_lib/catalog-i18n";
import { field } from "../../_lib/forms";
import { parsePounds } from "../../_lib/money";

const PAGE_SIZE = 25;
const STATUSES = ["DRAFT", "PUBLISHED", "DISABLED", "ARCHIVED"];

/** Product list with search, status filter and product creation (API §13, TASK-014). */
export default function ProductsPage() {
  return (
    <Guard anyOf={["PRODUCT_VIEW"]}>
      <Products />
    </Guard>
  );
}

function Products() {
  const { c } = useCatalogT();
  const can = useCan();
  const name = useLocalName();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) query.set("search", search);
  if (status) query.set("status", status);
  const { state, reload } = useApiData<ProductSummaryView[]>(`/api/v1/admin/products?${query}`);

  return (
    <>
      <CatalogTabs />
      <PageTitle
        aside={
          can("PRODUCT_CREATE") && !creating ? (
            <Button onClick={() => setCreating(true)}>{c.newProduct}</Button>
          ) : null
        }
      >
        {c.products}
      </PageTitle>
      {creating ? <CreateProduct onCancel={() => setCreating(false)} /> : null}
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={submit((form) => {
          setSearch(field(form, "search") ?? "");
          setPage(1);
        })}
      >
        <div className="min-w-56 flex-1">
          <Input label={c.search} name="search" placeholder={c.searchProducts} type="search" />
        </div>
        <div>
          <Select
            label={c.status}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{c.allStatuses}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {c.statuses[s]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">{c.search}</Button>
      </form>
      <Loaded load={state} reload={reload}>
        {(products) => (
          <>
            <Table head={["", c.name, c.sku, c.brand, c.status, c.variants]}>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-soft">
                    {c.empty}
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id} className="hover:bg-velvet-low">
                    <td className="w-14 px-3 py-2">
                      {product.mainImage ? (
                        // eslint-disable-next-line @next/next/no-img-element -- staff-only API file, needs the session cookie
                        <img
                          src={product.mainImage.url}
                          alt=""
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <span className="block h-10 w-10 rounded bg-velvet-low" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/staff/products/${product.id}`}
                        className="font-semibold text-plum hover:underline"
                      >
                        {name(product)}
                      </Link>
                      <span className="block text-xs text-ink-soft" dir="ltr">
                        {product.slug}
                      </span>
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {product.defaultVariant?.sku}
                    </td>
                    <td className="px-3 py-2">{product.brand ? name(product.brand) : "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="px-3 py-2">{product.activeVariantCount}</td>
                  </tr>
                ))
              )}
            </Table>
            <Pager page={page} count={products.length} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Loaded>
    </>
  );
}

function CreateProduct({ onCancel }: { onCancel: () => void }) {
  const { c } = useCatalogT();
  const can = useCan();
  const router = useRouter();
  const { run, pending, notice, fail } = useAction();
  const withPrice = can("EDIT_PRODUCT_PRICE");

  return (
    <Card title={c.newProduct}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={submit((form) => {
          const priceText = field(form, "price");
          const sellingPrice = priceText === undefined ? undefined : parsePounds(priceText);
          if (sellingPrice === null) {
            fail(c.invalidAmount);
            return;
          }
          void run(async () => {
            const product = await staffPost<ProductView>("/api/v1/admin/products", {
              nameAr: field(form, "nameAr") ?? "",
              nameEn: field(form, "nameEn") ?? "",
              slug: field(form, "slug"),
              defaultVariant: { sku: field(form, "sku") ?? "", sellingPrice },
            });
            router.push(`/staff/products/${product.id}`);
          });
        })}
      >
        <Input label={c.nameAr} name="nameAr" required dir="rtl" />
        <Input label={c.nameEn} name="nameEn" required dir="ltr" />
        <Input label={c.slug} name="slug" dir="ltr" />
        <Input label={c.defaultVariantSku} name="sku" required dir="ltr" />
        {withPrice ? <Input label={c.price} name="price" inputMode="decimal" dir="ltr" /> : null}
        <div className="flex gap-2 sm:col-span-2">
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
