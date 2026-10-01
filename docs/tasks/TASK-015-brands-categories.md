# TASK-015 — Brands, Categories & Catalog Relations

## Goal
Staff can manage brands and a category tree in the dashboard API, and give each product a brand and the categories it is listed in. Brands and categories are deactivated, never deleted.

## Dependencies
TASK-014 (products), TASK-012 (permissions), TASK-013 (audit log). Used by TASK-017 (publish checks), the discount tasks (`discount_brands`, `discount_categories`), analytics and the storefront (TASK-058+).

## Source of Truth
- Business Spec Q75, R14, R19
- DB Design §5 `brands`, `categories`, `product_categories`, `products.brand_id`, §22, "v1.2 TASK-015 Amendments"
- API Contract §13, "TASK-015 Amendments"
- Permission catalog §1 (`TAXONOMY_MANAGE`), §3 (Catalog Editor)
- ADR-0019 (slug and no-delete conventions), ADR-0020 (this task)

## Scope
- Tables `brands`, `categories`, `product_categories` and column `products.brand_id` (migration `brands_categories`), delete-rejecting triggers, slug format and not-own-parent checks, sibling-scoped slug indexes.
- Service `src/server/modules/catalog/taxonomy-service.ts`: create, list, edit, deactivate and reactivate brands; create, list (tree order), edit, move, deactivate and reactivate categories. Audit entries for each change.
- Products: `brandId` and `categoryIds` on create and edit, `brand` and `categories` in responses, `brandId` / `categoryId` list filters.
- Admin endpoints of API §13: `GET/POST /admin/brands`, `PATCH /admin/brands/{id}`, `GET/POST /admin/categories`, `PATCH /admin/categories/{id}`.

## Non-Goals
- Public `GET /brands` and `GET /categories` (storefront tasks, TASK-058+).
- Brand logos and category images (TASK-016).
- Publish rules that need a brand or category (TASK-017).
- Manual sort order of categories, slug redirects.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261001174012_brands_categories/`
- `src/server/modules/catalog/` (`taxonomy-service.ts`, `errors.ts`, `schemas.ts`, `products-service.ts`)
- `src/app/api/v1/admin/brands/{,[id]/}route.ts`, `src/app/api/v1/admin/categories/{,[id]/}route.ts`
- `src/server/modules/audit/audit.ts` (new action codes and entity types)

## Business Rules
- Q75 / DB §5: deactivate, never hard-delete.
- R14: names (and brand descriptions) in Arabic and English.
- R19: no approval requests for catalog changes.
- DB §22: brand slug unique; category slug unique within parent scope.
- Defaults where the documents are silent: ADR-0020 §4 (listed under Open Items).

## API Changes
API Contract "TASK-015 Amendments".

## Database Changes
Migration `brands_categories`. DB Design "v1.2 TASK-015 Amendments".

## Security / Authorization
`PRODUCT_VIEW` to list, `TAXONOMY_MANAGE` to change brands and categories, `PRODUCT_CREATE` / `PRODUCT_EDIT` to link products, enforced server-side; cookie writes need the `Origin` check. Every change is audited with actor, before/after and request id.

## Acceptance Criteria
- Brands and categories can be created, listed, edited, deactivated and reactivated, each with an audit entry; nothing can be deleted in the database.
- Categories form a tree of at most 3 levels without loops; slugs are unique among siblings, also under concurrent requests.
- An active category never sits under an inactive one.
- Products can be given one brand and up to 10 categories, changed and removed, filtered by brand and category; only active brands and categories can be newly linked.
- Each endpoint requires its permission; all required checks pass.

## Tests
- Unit `src/server/modules/catalog/taxonomy.test.ts`: brand, category and product-link schemas.
- Integration `src/server/modules/catalog/taxonomy-service.int.test.ts`: delete triggers, own-parent check, sibling slugs (service and database), concurrent duplicate slug, depth limit when creating and moving, loops, active-parent rules, tree order, inactive links.
- Route tests `src/app/api/v1/admin/taxonomy-routes.int.test.ts`: 401/403, Origin check, brand and category lifecycles with audit entries, product links, filters, unknown and inactive references.

## Edge Cases
- Two staff create a category with the same slug under the same parent at once: one gets `409 SLUG_TAKEN`.
- A brand is deactivated while a product is being linked to it: one waits for the other, so no new link to an already inactive brand.
- Moving a branch that would exceed 3 levels is refused, even if the category itself would fit.
- An edit that changes nothing writes no audit entry.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Defaults where the documents are silent (ADR-0020 §4), confirmed by the product owner on 2026-10-01:
1. A product's brand is optional (at most one); publish rules are TASK-017.
2. Up to 10 categories per product, at any level.
3. Categories at most 3 levels deep.
4. Brand and category slugs can change at any time (no storefront links yet).
5. Deactivating a brand or category can be undone.
6. Inactive brands and categories keep existing product links but cannot be newly linked.
7. An active category always has active parents.
8. Alphabetical order by English name; no manual sort order yet.
9. The product category filter matches that category only, not subcategories.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
