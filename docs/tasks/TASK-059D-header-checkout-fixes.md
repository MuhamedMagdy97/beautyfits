# TASK-059D — Storefront header, checkout areas and form validation

## Goal

Fix what the product owner found in the running storefront (2026-10-16):

1. The checkout "Area" list was empty.
2. Missing fields showed the browser's own bubble ("Please select an item in the list").
3. The header lacked the Stitch announcement bar and category row (Home, Shop, categories, New arrivals).

## Dependencies

TASK-009 (managed locations, R32), TASK-027 (shipping rules, R37), TASK-058/059/059B (storefront).

## Source of Truth

- Business Spec R32 (governorates and areas are a managed list), R37 / Q123 (free-shipping threshold).
- `design-reference/google-stitch/beautyfits_luxury_beauty_homepage` (header).

## Scope

- **Cause of the empty Area list:** the database had the 27 preloaded governorates but no areas and no shipping rules, and the dashboard had no screen to manage them.
  - The dashboard screens are TASK-055A.
  - Here, `npm run db:seed:dev` adds sample areas (Cairo, Giza, Alexandria) and, only while no rule exists, one catch-all rule with a placeholder 60 EGP fee. Both go through the locations and shipping services, with audit (`src/server/modules/bootstrap/dev-locations.ts`).
- **Address form** (`src/app/(store)/_components/address-form.tsx`): the Area list says "Choose the governorate first" until one is chosen. A governorate with no areas shows "No areas are available for this governorate yet" instead of an empty list.
- **Form validation** (`src/app/_components/form-validation.tsx`, mounted once in the root layout):
  - It covers every storefront and dashboard form. The browser bubble is suppressed and a localized message is shown under the field (`data-error` on its label/fieldset, styled in `globals.css`).
  - The field is marked `aria-invalid`, the first failing field is focused, and its message is read out through a live region.
  - Native constraints (`required`, `type="email"`, `minLength`…) are unchanged; the API still validates everything.
- **Header** (`src/app/(store)/_components/shell.tsx`):
  - The announcement bar ("Free shipping on orders over {amount} • Cash on delivery across Egypt"). The amount comes from the live setting through the new public `GET /shipping/free-shipping-threshold`; it is never hard-coded.
  - The category row: Home, Shop, the active top-level categories from `GET /categories`, and New arrivals. The current page is underlined.
  - A wishlist icon.

## Non-Goals

- Dashboard screens for areas and shipping rules (TASK-055A).
- "Best Sellers" and "Offers" links of the Stitch header: see Open Items.

## API Changes

`GET /shipping/free-shipping-threshold` (public), API contract "TASK-059D Amendments".

## Database Changes

None (dev seed data only).

## Tests

- `src/server/modules/bootstrap/dev-locations.int.test.ts`:
  - the seed adds the areas and rule through the services with audit
  - a second run changes nothing
  - the seed refuses production
  - the public threshold endpoint returns the setting
- Browser check in Arabic:
  - the header and category row
  - Area list states: no governorate, Cairo with 7 areas, Aswan with none
  - empty submit shows inline messages, focuses the first field and suppresses the bubble
  - typing clears the message

## Open Items

- [BUSINESS DECISION REQUIRED] "Best Sellers" and "Offers" links in the Stitch header are not built. "Best seller" (manual pick or sales ranking, over what period) and "Offers" (active discounts? which products?) are not defined (also TASK-059 open items).

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
