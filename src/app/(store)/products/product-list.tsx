"use client";

import { useRouter } from "next/navigation";
import { StatusPanel, TextLink } from "@/app/_components/ui";
import { Loaded, Page, PageTitle, Pager, ProductCard, useStoreData } from "../_components/shop";
import type { Pagination } from "../_lib/api";
import { useT } from "../_lib/i18n";
import type { Brand, Category, ProductSummary } from "../_lib/types";

export interface ListQuery {
  search: string;
  categoryId: string;
  brandId: string;
  sort: "newest" | "price_asc" | "price_desc";
  page: number;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** The page URL (or, with `base`, the API path) of a query, without empty values. */
export function listHref(query: ListQuery, base = "/products"): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (UUID.test(query.categoryId)) params.set("categoryId", query.categoryId);
  if (UUID.test(query.brandId)) params.set("brandId", query.brandId);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

/**
 * Product listing and search (Stitch `beautyfits_shop_all_products`): filter
 * by category (subcategories included) and brand, sort, pages of 24.
 */
export function ProductList({ query }: { query: ListQuery }) {
  const t = useT();
  const router = useRouter();
  const products = useStoreData<{ data: ProductSummary[]; pagination: Pagination }>(
    listHref(query, "/api/v1/products"),
    true,
  );
  const categories = useStoreData<Category[]>("/api/v1/categories");
  const brands = useStoreData<Brand[]>("/api/v1/brands");

  const go = (changes: Partial<ListQuery>) =>
    router.push(listHref({ ...query, page: 1, ...changes }));

  const select =
    "rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-plum";

  return (
    <Page>
      <PageTitle>
        {query.search ? t.shop.resultsFor.replace("{q}", query.search) : t.shop.title}
      </PageTitle>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <form action="/products" role="search" className="w-full sm:w-auto">
          <input
            key={query.search}
            type="search"
            name="search"
            maxLength={100}
            defaultValue={query.search}
            aria-label={t.shop.search}
            placeholder={t.shop.searchPlaceholder}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-plum sm:w-64"
          />
        </form>
        {categories.state.status === "ready" ? (
          <select
            aria-label={t.shop.category}
            value={query.categoryId}
            onChange={(event) => go({ categoryId: event.target.value })}
            className={select}
          >
            <option value="">{t.shop.allCategories}</option>
            {categories.state.data.map((c) => (
              <option key={c.id} value={c.id}>
                {"— ".repeat(c.depth - 1)}
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
        {brands.state.status === "ready" ? (
          <select
            aria-label={t.shop.brand}
            value={query.brandId}
            onChange={(event) => go({ brandId: event.target.value })}
            className={select}
          >
            <option value="">{t.shop.allBrands}</option>
            {brands.state.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label={t.shop.sort}
          value={query.sort}
          onChange={(event) => go({ sort: event.target.value as ListQuery["sort"] })}
          className={`${select} ms-auto`}
        >
          <option value="newest">{t.shop.sortNewest}</option>
          <option value="price_asc">{t.shop.sortPriceAsc}</option>
          <option value="price_desc">{t.shop.sortPriceDesc}</option>
        </select>
      </div>

      <Loaded load={products.state} reload={products.reload}>
        {(page) =>
          page.data.length === 0 ? (
            <StatusPanel
              title={t.shop.noResults}
              action={<TextLink href="/products">{t.shop.clearFilters}</TextLink>}
            />
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-soft">
                {t.shop.showing.replace("{n}", String(page.pagination.total))}
              </p>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {page.data.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <Pager
                page={page.pagination.page}
                totalPages={page.pagination.totalPages}
                href={(n) => listHref({ ...query, page: n })}
              />
            </>
          )
        }
      </Loaded>
    </Page>
  );
}
