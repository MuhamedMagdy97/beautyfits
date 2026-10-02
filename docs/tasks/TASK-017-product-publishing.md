# TASK-017 — Product Publishing & Archive Lifecycle

## Goal
Staff move products through their lifecycle: publish a draft once it is ready for customers, take it back to draft, pause it (disable) and retire it for good (archive). Nothing is ever hard-deleted; an archived product stays for order history, reviews and analytics.

## Dependencies
TASK-014 (products, variants), TASK-015 (brands, categories), TASK-016 (media: publishing needs a main image), TASK-012 (permissions), TASK-013 (audit log). Used by TASK-018 (adds the "has a selling price" publish check), the cart and checkout tasks (only published products are purchasable), the storefront (TASK-058+) and the new-product campaign flow (User Flows §16.4).

## Source of Truth
- Business Spec Q22, Q23, Q75, Q178, R18, R19
- User Flows §4.1, §4.2
- DB Design §5 `products`, "v1.2 TASK-014/016 Amendments", "v1.2 TASK-017 Amendments"
- API Contract §13, "TASK-017 Amendments"
- Permission catalog §1 (`PRODUCT_PUBLISH`, `PRODUCT_ARCHIVE`), §3
- ADR-0019 §4 items 3, 4, 7; ADR-0020 §4 item 1; ADR-0021 §5 item 6; ADR-0022 (this task)

## Scope
- `POST /admin/products/{id}/publish`, `/unpublish`, `/disable`, `/archive` (API §13), each with an optional `reason`.
- Publish checks: a current main image (Q178) and, when the product has more than one active variant, a name on every active variant.
- `products.first_published_at`; the slug is locked once a product has been published.
- Database guards: archiving is final; `archived_at` is set exactly for archived products; a published product has `first_published_at`.
- While a product is published: adding a variant or clearing a variant name may not leave several active variants with one unnamed.
- Images of archived products stay public (wishlists, order history); disabled and draft ones stay private.
- Audit entries `PRODUCT_PUBLISHED`, `PRODUCT_UNPUBLISHED`, `PRODUCT_DISABLED`, `PRODUCT_ARCHIVED`.

## Non-Goals
- Selling price and its publish check (TASK-018).
- Public catalog endpoints and dashboard screens (TASK-052+, TASK-058+).
- Cart, wishlist and checkout behaviour for non-published products (their own tasks; they read `products.status`).
- The "product published" campaign suggestion (User Flows §16.4, marketing tasks).
- Bulk status changes and scheduled publishing.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_product_lifecycle/`
- `src/server/modules/catalog/` (`lifecycle.ts`, `products-service.ts`, `media-service.ts`, `schemas.ts`)
- `src/app/api/v1/admin/products/[id]/{publish,unpublish,disable,archive}/route.ts`
- `src/app/api/v1/files/[id]/content/route.ts` (public rule)
- `src/server/modules/audit/audit.ts` (new action codes)

## Business Rules
- Q22 / User Flows §4.1: new products are Draft; Admin controls visibility.
- Q23 / Q75: archive or disable only; hard delete prohibited.
- Q178: a published product has a main image.
- R18: by default no Manager-level role publishes products (`PRODUCT_PUBLISH` and `PRODUCT_ARCHIVE` are in no default role).
- R19: no approval requests for catalog changes.
- Product-owner decisions of 2026-10-02 (ADR-0022 §4).

## API Changes
API Contract "TASK-017 Amendments".

## Database Changes
Migration `product_lifecycle`. DB Design "v1.2 TASK-017 Amendments".

## Security / Authorization
`PRODUCT_PUBLISH` for publish and unpublish, `PRODUCT_ARCHIVE` for disable and archive, enforced server-side; cookie writes need the `Origin` check. Each transition is audited with actor, previous and new status, reason and request id.

## Acceptance Criteria
- A draft or disabled product with a main image (and named variants when it has several) can be published; otherwise publishing is refused listing every missing requirement, and nothing changes.
- Published and disabled products can go back to draft; published products can be disabled; any product that is not archived can be archived; archived products never change again.
- Repeating a transition returns the same product and writes no audit entry; a transition not allowed from the current status is refused.
- The slug cannot change once the product has been published, also after it goes back to draft.
- A published product cannot get into a state that publishing would refuse (last image, unnamed variants).
- Images of published and archived products are public; draft and disabled ones need a staff session.
- Each endpoint requires its permission; all required checks pass.

## Tests
- Unit `src/server/modules/catalog/lifecycle.test.ts`: the transition table, publish requirements.
- Integration `src/server/modules/catalog/products-service.int.test.ts`: archive-is-final trigger, status/timestamp check constraints, concurrent publish and image removal.
- Route tests `src/app/api/v1/admin/lifecycle-routes.int.test.ts`: 401/403 per endpoint, Origin check, each transition and its audit entry, repeats, refused transitions, publish requirements, slug lock after unpublish, variant name guard on published products, archived product read-only, public image rule.

## Edge Cases
- Publish and remove the last image at the same time: both lock the product row, so either the image is removed and the publish is refused, or the publish wins and the removal is refused.
- A product with one unnamed default variant is published, then a second variant is added: refused until the default is named.
- A product is disabled, its last image cannot be removed while published, but can be while disabled; publishing again re-checks.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
Decisions taken by the product owner on 2026-10-02 (ADR-0022 §4):
1. Disabled is a pause (not visible or purchasable, still editable, can be published again); Archived is final in v1 and read-only.
2. Publish needs a main image and, with several active variants, names on all of them. A brand, categories and descriptions are not required.
3. The slug is locked once the product has ever been published.
4. Images of archived products stay public; draft and disabled ones are private.

Technical defaults (ADR-0022 §5): disable only from Published; unpublish from Published or Disabled; reason optional on all four.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
