# ADR-0053 — Catalog & inventory dashboard screens

**Status:** Accepted (TASK-053, 2026-10-14)

## Context
TASK-053 adds the first feature screens to the staff dashboard of ADR-0045: products, variants, brands, categories, images, prices, costs, stock balances, movements and low-stock alerts. The API for all of them exists (TASK-014..020). There is no Stitch reference for dashboard screens. Other feature screens (TASK-054..057) are built in parallel and share the shell files.

## Decision
1. **Routes.** Real routes replace the placeholder for the two existing navigation sections: `/staff/products` (list + create), `/staff/products/[id]` (details, status changes, variants, prices, opening costs, images), `/staff/products/brands`, `/staff/products/categories` (tabs inside the Products section), `/staff/inventory` (all / low stock) and `/staff/inventory/[variantId]` (balances, movements, adjustment). Static `brands`/`categories` segments win over `[id]` (product ids are UUIDs). No navigation, shell or shell-dictionary file changes.
2. **Client of the API only.** Screens call `/api/v1/**` through `staffApi`/`staffPost`; response types are imported type-only from `src/server/modules/**` (erased at build, extends ADR-0045's single type import). The screens hold no business rule: every value is validated and authorized by the API, whose `CONFLICT` reasons are shown localized. The only contract mirror is which lifecycle buttons a status offers (API "TASK-017 Amendments" table); the API still decides.
3. **Permissions.** Each screen is guarded by its read permission (`PRODUCT_VIEW`, `INVENTORY_VIEW`); actions are shown only with their permission (`PRODUCT_CREATE/EDIT/PUBLISH/ARCHIVE`, `MANAGE_PRODUCT_MEDIA`, `EDIT_PRODUCT_PRICE`, `EDIT_COST_PRICE` + `VIEW_COST_PRICE`, `TAXONOMY_MANAGE`, `ADJUST_INVENTORY`). Cosmetic only; costs appear only when the API returns them.
4. **Texts.** Catalog texts live in `_lib/catalog-i18n.ts` (Arabic and English, R14), separate from the shell dictionary so parallel feature tasks do not edit one file.
5. **Money.** Staff type and read pounds; `_lib/money.ts` converts to and from integer piastres with string arithmetic (no floating point). Margins in basis points are shown as percentages.
6. **Paging.** The shared client returns only `data`, so lists offer "next" while a page comes back full instead of reading `meta.pagination` (known ceiling: one empty last page on an exact multiple).

## Consequences
- No API, database or permission changes.
- Later feature screens can reuse `_components/catalog-ui.tsx` (`useApiData`, `Loaded`, `useAction`, `Guard`, `Pager`, form controls).
