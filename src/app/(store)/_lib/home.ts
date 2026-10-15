import type { Category } from "./types";

/** The top-level categories, in the API's tree order (home page tiles). */
export function topCategories(categories: Category[], max = 4): Category[] {
  return categories.filter((c) => c.parentId === null).slice(0, max);
}

/**
 * The shop link of the first top-level category whose slug matches `pattern`,
 * else the whole shop. ponytail: slug match on the English slug; replace with
 * an owner-chosen category per editorial block if these blocks become managed.
 */
export function categoryHref(categories: Category[], pattern: RegExp): string {
  const match = categories.find((c) => c.parentId === null && pattern.test(c.slug));
  return match ? `/products?categoryId=${match.id}` : "/products";
}
