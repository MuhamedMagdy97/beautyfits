"use client";

import { useState } from "react";
import type { ProductSummaryView } from "@/server/modules/catalog/products-service";
import type { BrandView, CategoryView } from "@/server/modules/catalog/taxonomy-service";
import { Button, useApiData, useLocalName } from "../../_components/catalog-ui";
import { useMarketingT } from "../../_lib/marketing-i18n";

/**
 * Pickers for product, brand and category ids, shared by discount targets
 * and campaign segments (TASK-056). They read the admin catalog lists
 * (`PRODUCT_VIEW`); without that permission the list shows the API error.
 */

const field =
  "block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-sm text-ink outline-none focus:border-plum focus:ring-2 focus:ring-blush";

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Checkbox list of all brands or categories. */
export function TaxonomyPicker({
  kind,
  value,
  onChange,
}: {
  kind: "brands" | "categories";
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { m, fail } = useMarketingT();
  const name = useLocalName();
  // ponytail: first 100 brands only (API page cap); page through them if the store outgrows it.
  const path = kind === "brands" ? "/api/v1/admin/brands?pageSize=100" : "/api/v1/admin/categories";
  const { state } = useApiData<(BrandView | CategoryView)[]>(path);
  return (
    <fieldset className="text-sm">
      <legend className="mb-1 text-ink-soft">
        {m[kind]} · {m.chosen.replace("{n}", String(value.length))}
      </legend>
      {state.status === "loading" ? <p className="text-ink-soft">…</p> : null}
      {state.status === "error" ? <p className="text-danger">{fail(state.error)}</p> : null}
      {state.status === "ready" ? (
        <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
          {state.data.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={value.includes(item.id)}
                onChange={() => onChange(toggle(value, item.id))}
              />
              <span style={"depth" in item ? { paddingInlineStart: (item.depth - 1) * 12 } : {}}>
                {name(item)}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

/** Product search with chosen products kept as removable chips. */
export function ProductPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { m, fail } = useMarketingT();
  const name = useLocalName();
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  // Names of products chosen in this form; ids loaded from a saved record show as ids.
  const [names, setNames] = useState<Record<string, string>>({});
  const query = new URLSearchParams({ pageSize: "10" });
  if (search) query.set("search", search);
  const { state } = useApiData<ProductSummaryView[]>(`/api/v1/admin/products?${query}`);
  return (
    <fieldset className="text-sm">
      <legend className="mb-1 text-ink-soft">
        {m.products} · {m.chosen.replace("{n}", String(value.length))}
      </legend>
      <ul className="mb-2 flex flex-wrap gap-2">
        {value.map((id) => (
          <li
            key={id}
            className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5"
          >
            <span dir={names[id] ? undefined : "ltr"}>{names[id] ?? id.slice(0, 8)}</span>
            <button
              type="button"
              aria-label={`${m.remove} ${names[id] ?? id}`}
              className="text-danger"
              onClick={() => onChange(value.filter((x) => x !== id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setSearch(typed.trim());
            }
          }}
          placeholder={m.searchProducts}
          aria-label={m.searchProducts}
          className={field}
        />
        <Button variant="plain" onClick={() => setSearch(typed.trim())}>
          {m.search}
        </Button>
      </div>
      {state.status === "error" ? <p className="mt-1 text-danger">{fail(state.error)}</p> : null}
      {state.status === "ready" ? (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-line">
          {state.data.map((product) => (
            <li key={product.id} className="border-b border-line last:border-0">
              <label className="flex items-center gap-2 px-2 py-1 text-ink">
                <input
                  type="checkbox"
                  checked={value.includes(product.id)}
                  onChange={() => {
                    setNames({ ...names, [product.id]: name(product) });
                    onChange(toggle(value, product.id));
                  }}
                />
                {name(product)}
                {product.defaultVariant ? (
                  <span dir="ltr" className="text-xs text-ink-soft">
                    {product.defaultVariant.sku}
                  </span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
