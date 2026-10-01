# ADR-0020 — Brands and categories

- **Status:** Accepted (TASK-015); the defaults in §4 await the product owner's confirmation
- **Date:** 2026-10-01
- **Relates to:** ADR-0019 (products and variants), ADR-0016 (permissions), ADR-0018 (audit logs); Business Spec Q75, R14, R19; DB Design §5, §22; API Contract §13 and "TASK-015 Amendments"; permission catalog §1, §3

## 1. Model

- `brands`: a flat list. `categories`: a tree through `parent_id` (null for a top-level category). `product_categories` links products to categories (many-to-many). `products.brand_id` gives a product at most one brand (DB Design: Product N─1 Brand).
- Names and the brand description are stored in Arabic and English (R14), like products. The DB design gives categories no description, so none is added.
- **Slugs** follow ADR-0019: lowercase Latin letters, digits and single hyphens, made from the English name when not given; a taken slug is refused (`409 SLUG_TAKEN`), not numbered. Brand slugs are unique; category slugs are unique among siblings (DB Design §22 "category slug within parent scope"), enforced by two partial unique indexes (top level, and per parent).
- **Nothing is hard-deleted** (Q75). Brands and categories have `ACTIVE | INACTIVE`; the existing `catalog_reject_delete` trigger now also guards `brands` and `categories`. Foreign keys from products and links are `RESTRICT`. A row in `product_categories` is removed when a category is taken off a product; the product's audit entries keep the earlier list.
- **Not in this task:** the public `GET /categories` and `GET /brands` endpoints (with the storefront tasks, TASK-058+, like the public product endpoints), brand logos and category images (media, TASK-016), and whether a product needs a brand or category to be published (TASK-017).

## 2. Authorization and audit

- Permissions as in API §13: `PRODUCT_VIEW` to list brands and categories, `TAXONOMY_MANAGE` to create, edit, move, deactivate and reactivate them. Linking a product to a brand or categories is a product edit (`PRODUCT_CREATE` on create, `PRODUCT_EDIT` afterwards).
- Audit actions `BRAND_CREATED`, `BRAND_UPDATED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED` (entity types `BRAND`, `CATEGORY`), written in the same transaction with the request id; status changes are `*_UPDATED` entries with the old and new status. Product snapshots in `PRODUCT_CREATED` / `PRODUCT_UPDATED` now include `brandId` and `categoryIds`. A change that changes nothing writes no entry.
- **No approval requests** (R19).

## 3. Concurrency

- Every category write takes one transaction-level advisory lock (`catalog:category-tree`) and reads the whole tree, so depth, loop and active-parent checks never race. The tree is small.
- Linking a product takes `FOR SHARE` on the brand and newly added categories; deactivating takes `FOR UPDATE` on the row. A link and a deactivation at the same moment run one after the other, so a product is never newly linked to a brand or category that was already inactive.
- Slug uniqueness is checked first for a clear error and enforced by the unique indexes; a lost race gets the same `409`.

## 4. Defaults where the documents are silent (to confirm)

1. **Brand is optional** on a product, at most one. Whether a published product must have one is left to TASK-017's publish checks.
2. **Up to 10 categories per product**, at any level of the tree (a product can sit in "Makeup" and in "Makeup › Lips").
3. **Categories are at most 3 levels deep** (for example Makeup › Lips › Lipstick). Moving a branch is refused if it would go deeper.
4. **Brand and category slugs can change at any time.** Unlike products there is no Draft stage, and no storefront links exist yet. Old-link redirects can come with the storefront (TASK-058).
5. **Deactivate, never delete; reactivation is allowed.** Unlike archiving a variant, deactivating a brand or category is reversible, because nothing about orders depends on it.
6. **Inactive brands and categories keep their existing product links** but cannot be newly linked (`409 BRAND_INACTIVE` / `CATEGORY_INACTIVE`). The storefront will hide inactive ones.
7. **An active category always has active parents.** A category with active subcategories cannot be deactivated (`409 CATEGORY_HAS_ACTIVE_CHILDREN`), and nothing active can be created, moved or reactivated under an inactive parent (`409 PARENT_INACTIVE`).
8. **Order is alphabetical** by English name; there is no manual sort order yet. It can be added with the storefront menus if needed.
9. **Filtering products by category matches that category only**, not its subcategories.

## Consequences

- New migration `brands_categories` (three tables, one enum, `products.brand_id`, check constraints, delete triggers).
- New audit action codes and entity types.
- `src/server/modules/catalog/errors.ts` holds the error helpers both catalog services use.
- No new dependency.
