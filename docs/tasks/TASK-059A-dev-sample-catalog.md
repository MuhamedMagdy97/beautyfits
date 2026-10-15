# TASK-059A — Development Sample Catalog

## Goal
Give the local development database a small, realistic catalog so the storefront (`/products`, product pages, home page rows) shows content. Today `npm run db:seed:dev` only adds sample staff, so a fresh local site is empty.

## Dependencies
TASK-004 (bootstrap and development seed, ADR-0017), TASK-015 to TASK-019 (catalog, media, publishing, pricing, inventory ledger), TASK-059 (storefront).

## Source of Truth
- `docs/database/database-design.md` (catalog, `product_media`, `media_assets`, `inventory_movements`)
- ADR-0017 (development seed is separate from the production bootstrap), ADR-0021 (uploads), ADR-0022 (publishing), ADR-0023 (prices), ADR-0024 (inventory ledger)
- `design-reference/google-stitch/beautyfits_luxury_beauty_homepage` (category tiles)

## Scope
- `src/server/modules/bootstrap/dev-catalog.ts`: `runDevCatalogSeed`, called by `prisma/seed-dev.ts` after the sample staff.
- 4 fictional brands; categories Makeup, Perfumes, Skincare, Beauty Essentials with 2–3 subcategories each; 16 products (1–3 variants each, 24 variants), all `PUBLISHED`.
- Selling prices in integer piastres; opening stock as `MANUAL_ADJUSTMENT` inventory movements; one image per product uploaded from `prisma/fixtures/dev-catalog/<slug>.png`.
- One product (Cedar Vetiver) has no stock, to show the out-of-stock state.

## Non-Goals
- No change to the production bootstrap (`prisma/seed.ts`), the API, or the schema.
- No purchase orders or goods receipts: costs stay empty (cost-based margins are not shown for sample data).
- No discounts, reviews or orders.

## Files / Modules
- `prisma/seed-dev.ts`, `src/server/modules/bootstrap/dev-catalog.ts`, `src/server/modules/bootstrap/dev-catalog.int.test.ts`
- `prisma/fixtures/dev-catalog/*.png` (generated flat placeholder images, 800×800, no third-party content)
- `README.md`, `docs/testing/test-strategy.md`

## Business Rules
- Nothing is written directly: brands, categories, products, variants, prices, images, stock and publishing go through the existing services as the Owner, so audit entries, upload checks (type, size, scan), publish requirements and inventory movements are the same as for staff-made data.
- Refused when `NODE_ENV=production`, like the sample staff.

## API Changes
None.

## Database Changes
None (data only, development databases only).

## Security / Authorization
Development only. The seed acts as the Owner; uploads use the `MANAGE_PRODUCT_MEDIA` path with the normal checks. Sample SKUs start with `DEV-`.

## Acceptance Criteria
- After `npm run db:seed:dev`, `GET /api/v1/products` lists 16 published products with prices and images, and `/products` shows them.
- Re-running adds nothing and changes nothing; a run that stopped half way is completed by the next one.
- Every unit of stock has an inventory movement.

## Tests
- `dev-catalog.int.test.ts`: first run publishes every product with its main image, prices and stock equal to the movements; second run creates nothing and adds no movements or images; production is refused.

## Edge Cases
- Partial earlier run: each step checks what exists (slugs, SKUs, current images, movements) and only adds what is missing.
- An upload that completed but was not attached (crash in between) leaves an unused `SAFE` file; the next run uploads a new one. Harmless in development.
- Images live in `MEDIA_DIR`: run the seed with the same `MEDIA_DIR` as the dev server.

## Definition of Done
Lint, format, typecheck, unit and integration tests and build pass; seed run against the local database; API and storefront checked.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
