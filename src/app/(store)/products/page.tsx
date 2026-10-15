import { ProductList, type ListQuery } from "./product-list";

const SORTS = ["newest", "price_asc", "price_desc"] as const;

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

/** Shop / search (TASK-059): `/products?search=&categoryId=&brandId=&sort=&page=`. */
export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const params = await searchParams;
  const sort = one(params.sort);
  const query: ListQuery = {
    search: one(params.search),
    categoryId: one(params.categoryId),
    brandId: one(params.brandId),
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as ListQuery["sort"]) : "newest",
    page: Math.max(1, Number.parseInt(one(params.page), 10) || 1),
  };
  return <ProductList query={query} />;
}
