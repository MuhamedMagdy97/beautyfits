# TASK-053 — Catalog & Inventory Dashboard

## Goal
Staff manage products, variants, brands, categories, images, selling prices and opening costs, and see stock balances, movement history and low-stock alerts, from the dashboard at `/staff`, in Arabic and English.

## Dependencies
TASK-014 → TASK-020 (catalog and inventory API), TASK-052 (dashboard shell).

## Source of Truth
- Business Spec Q21, Q22, Q23, Q71–Q75, Q175–Q178, R14, R18, R19
- API Contract §13, §22, §28 and "TASK-014..020 Amendments"
- `docs/security/permission-catalog.md`
- Design reference: no dashboard screen exists in `design-reference/google-stitch/`; screens follow the Editorial Velvet design system as the shell does (ADR-0045).
- ADR-0045; ADR-0053 (this task)

## Scope
- `/staff/products`: list (search, status filter, paging), create product with default variant (and price with `EDIT_PRODUCT_PRICE`).
- `/staff/products/[id]`: details (names, slug while unlocked, descriptions, brand, categories, low-stock threshold); publish / back to draft / disable / archive with optional reason; variants (add, edit, make default, archive, threshold); price preview and apply with the API's margin warnings; opening costs while editable; images (upload, main, order, remove).
- `/staff/products/brands`, `/staff/products/categories`: list, create, edit, deactivate / reactivate.
- `/staff/inventory`: all variants (search) and low-stock view; `/staff/inventory/[variantId]`: balances, movements, manual adjustment (type, quantity, required reason).
- Loading, error with retry, access denied, empty states; RTL Arabic and English.

## Non-Goals
- API, database or permission changes.
- Target-margin price suggestions (the API supports them; the screen sends prices only).
- Editing alt text or variant of an image after upload (remove and upload again).
- Brand/category filters on the product list.
- Goods receipts and supplier returns (TASK-055).

## Files / Modules
- `src/app/staff/(shell)/products/{page.tsx,brands/page.tsx,categories/page.tsx}`
- `src/app/staff/(shell)/products/[id]/{page,variants,pricing,media}.tsx`
- `src/app/staff/(shell)/inventory/{page.tsx,[variantId]/page.tsx}`
- `src/app/staff/_components/catalog-ui.tsx`
- `src/app/staff/_lib/{catalog-i18n.ts,money.ts,forms.ts,catalog.test.ts}`
- `docs/decisions/ADR-0053-catalog-dashboard.md`

## Business Rules
None new. All rules are enforced by the API; the screens show its results and localized refusal reasons.

## API Changes
None.

## Database Changes
None.

## Security / Authorization
- Screens and actions are hidden without their permission (cosmetic); the API authorizes every call.
- Cost data is shown only when the API returns it (`VIEW_COST_PRICE`).
- Uploads use the API's single-use upload authorization; files are checked by the API.
- No business code is imported at runtime (type-only imports).

## Acceptance Criteria
- An employee with `PRODUCT_VIEW` sees products, brands and categories; without it, access denied.
- Create/edit/status/variant/price/cost/image/taxonomy actions appear only with their permission and show localized API errors.
- An employee with `INVENTORY_VIEW` sees balances, low-stock alerts and movements; with `ADJUST_INVENTORY` can adjust with a reason.
- Money is shown and entered in pounds and sent as integer piastres.
- Arabic renders right-to-left, English left-to-right.
- All required checks pass.

## Tests
- Unit `src/app/staff/_lib/catalog.test.ts`: piastre formatting/parsing (no floating point, refused inputs), conflict-reason localization incl. publish requirements, attribute and number field helpers.
- The flows themselves are covered by the existing catalog, media, lifecycle, pricing and inventory route integration tests.

## Edge Cases
- Archived product: read-only notice, no actions.
- Slug locked after first publish: field disabled.
- Inactive brand/category still linked to a product stays visible in the form.
- Exact multiple of the page size: one empty last page (ADR-0053 §6).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- No Stitch design exists for these dashboard screens; layout is a UX proposal following Editorial Velvet.
- Brands and categories are tabs inside "Products" so the shared navigation is unchanged; the product owner may want them as separate sidebar sections.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
