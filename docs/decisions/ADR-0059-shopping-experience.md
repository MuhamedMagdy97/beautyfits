# ADR-0059 — Public catalog endpoints and the storefront shopping screens

**Status:** Accepted (TASK-059, 2026-10-15)

## Context
TASK-059 adds the customer shopping screens on top of the storefront shell (ADR-0055). API §13 lists public `GET /products`, `/products/{productId}`, `/categories` and `/brands`, but they were not implemented. Cart, checkout, addresses, wishlist, restock and reviews endpoints already exist (TASK-009, 025–029, 042–044). The backend is authoritative for prices, stock, discounts and totals.

## Decision
1. **Public catalog service.** `src/server/modules/catalog/storefront-service.ts` serves the four endpoints. Only `PUBLISHED` products and their active, priced variants are visible; anything else is `404`. Responses carry the current selling price and an `AVAILABLE` / `OUT_OF_STOCK` status (Q20), never stock quantities, costs or margins. Names and descriptions are in the request language (R14). Inactive brands/categories are left out.
2. **Listing.** `search` matches product names (both languages) and brand names, case-insensitive (`ILIKE`, enough for the catalog size; a full-text index can come later). `categoryId` includes subcategories (the same `withSubcategories` rule as discounts, R36). Sort `newest` uses `firstPublishedAt`; `price_asc`/`price_desc` order by the lowest sellable variant price through a `groupBy` on variants. `pageSize` max 48.
3. **Slug or id.** `GET /products/{productId}` also accepts the product slug so storefront URLs are `/products/{slug}`; slugs are unique and locked once published (ADR-0022), so links stay stable.
4. **No discount on catalog prices.** Discounts are chosen in the cart (Q138, R36); the catalog shows list prices only.
5. **Screens.** `src/app/(store)`: `/products` (listing, search, filters, sort, pages), `/products/[slug]` (variants, add to bag, wishlist, Notify Me, reviews), `/cart` (quantities, remove, move to wishlist, accept new prices via `reprice`, discount code / offers), `/checkout` (guest contact or saved address, new address with the managed location list, wallet credit, `validate` then `checkout` with an `Idempotency-Key` and the confirmed `expectedTotal`, confirmation), `/account`, `/account/addresses`, `/wishlist` (customer only). They are client components using `storeApi`/`storeSend`/`storePage`; they display API values and compute nothing.
6. **Anonymous id.** The client keeps a random UUID (`bf_anon_id` in `localStorage`) and sends it as `X-Anonymous-Id` on every request (Q146); product views and checkout starts are posted to `/analytics/events`, failures ignored.
7. **Images.** Product images are the public `/api/v1/files/{id}/content` URLs shown with plain `<img loading="lazy">` (no image optimizer configuration needed).

## Consequences
- The catalog endpoints are public and uncached (`Cache-Control: no-store`, §6.1); caching/CDN and a search index are later performance work.
- Product pages are client-rendered: no server-side product metadata for SEO yet (open item).
- Writing a review needs the order item id, which the customer order response does not expose; the review form belongs to the order screens (TASK-060).
