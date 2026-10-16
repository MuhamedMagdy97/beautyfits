# TASK-055A — Locations & Shipping Rules Dashboard Screens

## Goal
The Owner/Admin manage the real delivery data from the dashboard: the managed location list (27 governorates and their areas) and the shipping rules that price delivery. Without them the storefront checkout has no areas to pick and no fee to quote.

## Dependencies
TASK-009 (locations API), TASK-027 (shipping rules API), TASK-052 (dashboard shell), TASK-053 (screen pieces), TASK-055 (shipping section, tabs, carriers).

## Source of Truth
- Business Spec R32 (managed location list), R37 (shipping fee), Q121–Q126, R14
- API Contract "TASK-009 Amendments" (`/admin/locations`, `/admin/governorates/{id}`, `/admin/governorates/{id}/areas`, `/admin/areas/{id}`) and "TASK-027 Amendments" (`/admin/shipping/rules`, `/admin/shipping/companies`)
- `docs/security/permission-catalog.md` (`SHIPPING_VIEW`, `SHIPPING_MANAGE`)
- ADR-0030, ADR-0033, ADR-0053, ADR-0058 (screen conventions followed; no new ADR)
- Design reference: no dashboard screen exists in `design-reference/google-stitch/`; the screens follow the shell tokens (ADR-0045).

## Scope
- `/staff/shipping/locations`: all governorates with code, Arabic/English names and status; search; expand a governorate to its areas; rename / deactivate / reactivate a governorate; add an area; rename / deactivate / reactivate an area.
- `/staff/shipping/rules`: list (filters status, governorate, carrier; paging), create, edit, activate / deactivate. Fields: carrier (or "staff choose"), governorate (or everywhere), area (or whole governorate), order-total range, fee, priority, active period, status. Money typed in pounds, sent as integer piastres.
- Both added to the shipping tabs (`tabs.tsx`), shown with `SHIPPING_VIEW`; change controls only with `SHIPPING_MANAGE` (cosmetic; the API decides).

## Non-Goals
- API, database or permission changes.
- The free-shipping threshold (a store setting, TASK-057 settings screen).
- Sample areas and rules in the dev seed (TASK-059D).

## Files / Modules
- `src/app/staff/(shell)/shipping/locations/page.tsx`, `rules/page.tsx`, `tabs.tsx`
- `src/app/staff/_lib/locations-i18n.ts` (texts, Arabic + English), `locations.ts` (rule form ↔ body), `locations.test.ts`

## Business Rules
- Governorates are fixed (27); nothing is deleted — only renamed or deactivated (R32).
- Area names unique within their governorate per language; the API refuses duplicates (`409 NAME_TAKEN`, shown localized).
- Rule matching (area → governorate → everywhere; then priority, then lower fee) is the API's; the screen only explains it. `minOrderTotal` inclusive, `maxOrderTotal` exclusive.
- An area implies its governorate: the area picker lists only the chosen governorate's areas and clears when the governorate changes.

## API Changes
None.

## Database Changes
None.

## Security / Authorization
Reads need `SHIPPING_VIEW`, changes `SHIPPING_MANAGE`, enforced by the existing endpoints. The client only hides controls.

## Acceptance Criteria
- [x] Staff with `SHIPPING_VIEW` see both tabs and the data; without it, "access denied".
- [x] With `SHIPPING_MANAGE`: rename/deactivate/reactivate governorates and areas, add areas; create, edit, activate/deactivate rules.
- [x] Fees and totals are entered in pounds and sent as integer piastres; unreadable input is pointed out before sending.
- [x] API refusals (duplicate name, max ≤ min, end before start, unknown references) are shown localized.
- [x] Arabic (RTL) and English.

## Tests
- `src/app/staff/_lib/locations.test.ts`: pounds → piastres and blanks → null, first unreadable field, area dropped without governorate, round-trip of an existing rule, Arabic/English key parity.
- Browser check (dev DB `beautyfits_s055a_dev`, port 3055, Owner): added area, duplicate refused, rule created with area, deactivated, editor prefilled, `below_minimum` shown; Arabic and English.

## Edge Cases
- Inactive governorates, areas and carriers stay pickable in the rule form, marked "(inactive)", so existing rules remain editable.
- Paging offers "next" while a page comes back full (shared `Pager` limitation).

## Open Items
- `GET /admin/shipping/rules` has no `areaId` filter; the screen filters by governorate only.
- The API does not say which rules or addresses use an area, so deactivating one shows no warning about rules that stop matching. Add a usage count to `/admin/locations` if the owner wants that warning.
- No `[BUSINESS DECISION REQUIRED]` items.

## Definition of Done
Screens work against the existing API; lint, format, typecheck, unit, integration tests and build pass; docs updated.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
