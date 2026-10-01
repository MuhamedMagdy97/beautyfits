# TASK-014 — Products & Canonical Variants/SKUs

## Goal
Staff can create products and their variants in the dashboard API. A product is the container customers will see; a variant is the canonical sellable unit with its own SKU. Every product, even a simple one, has exactly one default variant. Nothing is ever hard-deleted.

## Dependencies
TASK-012 (permissions, `requirePermission`), TASK-013 (audit log). Used by TASK-015 (brands, categories), TASK-016 (media), TASK-017 (publishing lifecycle), TASK-018 (prices and costs), TASK-019+ (stock) and every order, cart and wishlist task.

## Source of Truth
- Business Spec C6, Q73–Q75, Q184, R14, R17, R19
- User Flows §4.1
- DB Design §5 `products`, `product_variants`, §22, "Variant canonicalization", "v1.2 TASK-014 Amendments"
- API Contract §13, "TASK-014 Amendments"
- Permission catalog §1 (Catalog & pricing), §3 (Catalog Editor)
- ADR-0019 (this task)

## Scope
- Tables `products` and `product_variants` (migration `products_variants`), a trigger rejecting `DELETE` on both, one-default and default-is-active constraints.
- Service `src/server/modules/catalog/products-service.ts`: create product with its default variant, list/search, detail, edit, add variant, edit variant, move the default, archive variant. Audit entries for each change.
- Admin endpoints of API §13: `POST/GET /admin/products`, `GET/PATCH /admin/products/{id}`, `GET/POST /admin/products/{id}/variants`, `PATCH /admin/variants/{id}`, `POST /admin/variants/{id}/archive`.

## Non-Goals
- Brands and categories (TASK-015), media (TASK-016).
- Publish, unpublish, archive and disable products (TASK-017).
- Selling price, costs, price review and history (TASK-018); `PATCH /admin/variants/{id}/cost`.
- Stock and low-stock thresholds (TASK-019+).
- Public catalog endpoints and dashboard screens (TASK-052+, TASK-058+).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261001171602_products_variants/`
- `src/server/modules/catalog/` (`products-service.ts`, `schemas.ts`)
- `src/app/api/v1/admin/products/{,[id]/,[id]/variants/}route.ts`, `src/app/api/v1/admin/variants/[id]/{,archive/}route.ts`
- `src/server/modules/audit/audit.ts` (new action codes and entity types)

## Business Rules
- C6: every sellable SKU is a variant; a product without visible options has one default variant; SKU (later price, cost, stock) live on the variant.
- Q75 / DB §5: archive, never hard-delete.
- User Flows §4.1: new products are Draft.
- Q73: price changes are a separate permission (`EDIT_PRODUCT_PRICE`), so this task's content endpoints never touch price.
- R14: catalog text in Arabic and English.
- R19: no approval requests for catalog changes.
- Defaults where the documents are silent: ADR-0019 §4 (listed under Open Items).

## API Changes
API Contract "TASK-014 Amendments": endpoints, shapes, errors.

## Database Changes
Migration `products_variants`. DB Design "v1.2 TASK-014 Amendments".

## Security / Authorization
`PRODUCT_VIEW`, `PRODUCT_CREATE`, `PRODUCT_EDIT`, `PRODUCT_ARCHIVE` per endpoint, enforced server-side; cookie writes need the `Origin` check. Clients cannot set status, the default flag on create, prices or costs. Every change is audited with actor, before/after and request id.

## Acceptance Criteria
- Creating a product creates a Draft product and exactly one default variant atomically, with an audit entry; a refused create writes nothing.
- Products can be listed, searched (names, slug, SKU), viewed and edited; variants can be added, edited, made default and archived.
- A product always has exactly one active default variant; the default cannot be archived.
- SKUs and slugs are unique (SKUs ignoring case, archived variants included), also under concurrent requests.
- Deleting a product or variant row fails in the database.
- Each endpoint requires its permission; all required checks pass.

## Tests
- Unit `src/server/modules/catalog/catalog.test.ts`: slug derivation, SKU normalization, schemas (name pairs, attributes, ignored client fields, update rules, list query).
- Integration `src/server/modules/catalog/products-service.int.test.ts`: delete trigger, one-default and default-active constraints, case constraints, concurrent default moves, concurrent duplicate SKU, variant limit.
- Route tests `src/app/api/v1/admin/catalog-routes.int.test.ts`: 401/403 per endpoint, Origin check, create/list/search/detail/edit, slug and SKU conflicts, slug lock, archived product, add/edit/default move/archive of variants, audit entries and correlation id.

## Edge Cases
- Two staff move the default to different variants at once: one wins after the other, exactly one default remains.
- Two variants with the same SKU created at once on different products: one gets `409 SKU_TAKEN`.
- An edit that changes nothing writes no audit entry; repeating an archive returns the same variant.
- An English name with no Latin letters: the slug must be given.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Defaults where the documents are silent (ADR-0019 §4), waiting for the product owner's confirmation:
1. SKUs: typed by staff, letters/digits with `-` `_` `.`, stored in capitals, never reused.
2. SKUs can be corrected while the variant is active (orders keep their own copy).
3. Slug made from the English name when not given; a taken slug is refused, not numbered; it changes only while Draft.
4. Variant names optional, always in both languages or neither; naming rules for multi-variant products left to publishing (TASK-017).
5. The default variant cannot be archived; move the default or archive the product.
6. Archiving a variant is final in v1.
7. Archived products cannot be changed; disabled ones can.
8. At most 100 variants per product.
9. Variant attributes: up to 20 untranslated name/value pairs.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
