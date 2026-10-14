"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { ProductView } from "@/server/modules/catalog/products-service";
import type { BrandView, CategoryView } from "@/server/modules/catalog/taxonomy-service";
import {
  Button,
  Card,
  Guard,
  Input,
  Loaded,
  PageTitle,
  Select,
  StatusBadge,
  TextArea,
  useAction,
  useApiData,
  useCan,
  useLocalName,
} from "../../../_components/catalog-ui";
import { Notice, submit } from "../../../_components/ui";
import { staffApi, staffPost } from "../../../_lib/api";
import { useCatalogT } from "../../../_lib/catalog-i18n";
import { field, optionalInt } from "../../../_lib/forms";
import { MediaCard } from "./media";
import { CostsCard, PricesCard } from "./pricing";
import { VariantsCard } from "./variants";

/** One product: details, status changes, variants, prices, costs and images (TASK-014..019). */
export default function ProductPage() {
  return (
    <Guard anyOf={["PRODUCT_VIEW"]}>
      <Product />
    </Guard>
  );
}

function Product() {
  const { c } = useCatalogT();
  const name = useLocalName();
  const can = useCan();
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useApiData<ProductView>(`/api/v1/admin/products/${id}`);

  return (
    <Loaded load={state} reload={reload}>
      {(product) => {
        const readOnly = product.status === "ARCHIVED";
        return (
          <>
            <Link href="/staff/products" className="text-sm text-plum hover:underline">
              ← {c.products}
            </Link>
            <PageTitle aside={<StatusBadge status={product.status} />}>{name(product)}</PageTitle>
            {readOnly ? <Notice tone="info">{c.archivedReadOnly}</Notice> : null}
            {!readOnly && (can("PRODUCT_PUBLISH") || can("PRODUCT_ARCHIVE")) ? (
              <LifecycleCard product={product} onChange={reload} />
            ) : null}
            <DetailsCard product={product} onChange={reload} readOnly={readOnly} />
            <VariantsCard product={product} onChange={reload} readOnly={readOnly} />
            {!readOnly && can("EDIT_PRODUCT_PRICE") ? (
              <PricesCard product={product} onChange={reload} />
            ) : null}
            {!readOnly && can("EDIT_COST_PRICE") && can("VIEW_COST_PRICE") ? (
              <CostsCard product={product} onChange={reload} />
            ) : null}
            <MediaCard product={product} onChange={reload} readOnly={readOnly} />
          </>
        );
      }}
    </Loaded>
  );
}

/** Transitions offered per status, as listed in API "TASK-017 Amendments"; the API decides. */
const TRANSITIONS: Record<
  string,
  { action: string; permission: "PRODUCT_PUBLISH" | "PRODUCT_ARCHIVE" }[]
> = {
  DRAFT: [
    { action: "publish", permission: "PRODUCT_PUBLISH" },
    { action: "archive", permission: "PRODUCT_ARCHIVE" },
  ],
  PUBLISHED: [
    { action: "unpublish", permission: "PRODUCT_PUBLISH" },
    { action: "disable", permission: "PRODUCT_ARCHIVE" },
    { action: "archive", permission: "PRODUCT_ARCHIVE" },
  ],
  DISABLED: [
    { action: "publish", permission: "PRODUCT_PUBLISH" },
    { action: "unpublish", permission: "PRODUCT_PUBLISH" },
    { action: "archive", permission: "PRODUCT_ARCHIVE" },
  ],
};

function LifecycleCard({ product, onChange }: { product: ProductView; onChange: () => void }) {
  const { c } = useCatalogT();
  const can = useCan();
  const { run, pending, notice } = useAction(onChange);
  const [reason, setReason] = useState("");
  const labels: Record<string, string> = {
    publish: c.publish,
    unpublish: c.unpublish,
    disable: c.disable,
    archive: c.archiveProduct,
  };
  const actions = (TRANSITIONS[product.status] ?? []).filter((t) => can(t.permission));
  if (actions.length === 0) {
    return null;
  }
  return (
    <Card title={c.lifecycle}>
      {notice}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            label={c.reasonOptional}
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {actions.map(({ action }) => (
          <Button
            key={action}
            variant={action === "archive" ? "danger" : "primary"}
            disabled={pending}
            onClick={() => {
              if (action === "archive" && !window.confirm(c.confirmArchive)) {
                return;
              }
              void run(() =>
                staffPost(`/api/v1/admin/products/${product.id}/${action}`, {
                  reason: reason.trim() || undefined,
                }),
              );
            }}
          >
            {labels[action]}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function DetailsCard({
  product,
  onChange,
  readOnly,
}: {
  product: ProductView;
  onChange: () => void;
  readOnly: boolean;
}) {
  const { c } = useCatalogT();
  const can = useCan();
  const name = useLocalName();
  const { run, pending, notice } = useAction(onChange);
  const editable = !readOnly && can("PRODUCT_EDIT");
  // ponytail: first 100 active brands only (API page maximum); add a brand search when there are more.
  const brands = useApiData<BrandView[]>("/api/v1/admin/brands?status=ACTIVE&pageSize=100");
  const categories = useApiData<CategoryView[]>("/api/v1/admin/categories?status=ACTIVE");
  const slugLocked = product.firstPublishedAt !== null || product.status !== "DRAFT";
  const linked = new Set(product.categories.map((category) => category.id));

  // Active options plus whatever the product links to now (an inactive one stays visible).
  const brandOptions = [
    ...(brands.state.status === "ready" ? brands.state.data : []),
    ...(product.brand ? [product.brand] : []),
  ].filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i);
  const categoryOptions = [
    ...(categories.state.status === "ready" ? categories.state.data : []),
    ...product.categories.map((category) => ({ ...category, depth: 1 })),
  ].filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i);

  return (
    <Card title={c.details}>
      {notice}
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={submit((form) => {
          const body: Record<string, unknown> = {
            nameAr: field(form, "nameAr"),
            nameEn: field(form, "nameEn"),
            descriptionAr: field(form, "descriptionAr") ?? null,
            descriptionEn: field(form, "descriptionEn") ?? null,
            brandId: field(form, "brandId") ?? null,
            categoryIds: form.getAll("categoryIds").map(String),
            lowStockThreshold: optionalInt(String(form.get("lowStockThreshold") ?? "")),
          };
          if (!slugLocked) {
            body.slug = field(form, "slug");
          }
          void run(() =>
            staffApi(`/api/v1/admin/products/${product.id}`, {
              method: "PATCH",
              body: JSON.stringify(body),
            }),
          );
        })}
      >
        <fieldset disabled={!editable} className="contents">
          <Input label={c.nameAr} name="nameAr" required dir="rtl" defaultValue={product.nameAr} />
          <Input label={c.nameEn} name="nameEn" required dir="ltr" defaultValue={product.nameEn} />
          <div>
            <Input
              label={c.slug}
              name="slug"
              dir="ltr"
              defaultValue={product.slug}
              disabled={slugLocked}
            />
            {slugLocked ? <p className="mt-1 text-xs text-ink-soft">{c.slugLocked}</p> : null}
          </div>
          <Input
            label={c.lowStockThreshold}
            name="lowStockThreshold"
            inputMode="numeric"
            dir="ltr"
            defaultValue={product.lowStockThreshold ?? ""}
          />
          <TextArea
            label={c.descriptionAr}
            name="descriptionAr"
            dir="rtl"
            defaultValue={product.descriptionAr ?? ""}
          />
          <TextArea
            label={c.descriptionEn}
            name="descriptionEn"
            dir="ltr"
            defaultValue={product.descriptionEn ?? ""}
          />
          <Select
            label={c.brand}
            name="brandId"
            defaultValue={product.brand?.id ?? ""}
            key={`brand-${brandOptions.length}`}
          >
            <option value="">{c.noBrand}</option>
            {brandOptions.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {name(brand)}
              </option>
            ))}
          </Select>
          <fieldset className="text-sm text-ink-soft">
            <legend className="mb-1">{c.categories}</legend>
            <div className="max-h-48 overflow-y-auto rounded-md border border-line bg-velvet-low p-2">
              {categoryOptions.map((category) => (
                <label key={category.id} className="flex items-center gap-2 py-0.5 text-ink">
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={category.id}
                    defaultChecked={linked.has(category.id)}
                  />
                  <span style={{ paddingInlineStart: `${(category.depth - 1) * 1}rem` }}>
                    {name(category)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {editable ? (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {c.save}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>
    </Card>
  );
}
