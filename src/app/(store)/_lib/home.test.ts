import { describe, expect, it } from "vitest";
import { categoryHref, topCategories } from "./home";
import type { Category } from "./types";

const ID = "00000000-0000-4000-8000-00000000000";
const cat = (n: number, slug: string, parentId: string | null = null): Category => ({
  id: `${ID}${n}`,
  slug,
  name: slug,
  parentId,
  depth: parentId ? 2 : 1,
});

const categories = [
  cat(1, "makeup"),
  cat(2, "lipstick", `${ID}1`),
  cat(3, "fragrances"),
  cat(4, "skincare"),
  cat(5, "hair"),
  cat(6, "body"),
];

describe("topCategories", () => {
  it("keeps top-level categories in order, at most four", () => {
    expect(topCategories(categories).map((c) => c.slug)).toEqual([
      "makeup",
      "fragrances",
      "skincare",
      "hair",
    ]);
  });
});

describe("categoryHref", () => {
  it("links to the matching top-level category", () => {
    expect(categoryHref(categories, /fragrance|perfume/)).toBe(`/products?categoryId=${ID}3`);
  });

  it("ignores subcategories and falls back to the shop", () => {
    expect(categoryHref(categories, /lipstick/)).toBe("/products");
    expect(categoryHref([], /makeup/)).toBe("/products");
  });
});
