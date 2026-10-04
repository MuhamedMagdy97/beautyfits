# TASK-027 — Shipping Rules & Free Shipping Engine

## Goal
Staff manage the contracted shipping companies and the shipping rules (place, order-total band, period, priority, proposed company). The backend quotes one shipping fee for a cart sent to an area, free from a store-wide threshold on the total after discounts.

## Dependencies
TASK-009 (managed location list), TASK-025 (cart), TASK-026 (cart total after discounts), TASK-013 (audit), TASK-004 (settings).

## Source of Truth
- Business Spec Q6, Q121–Q126, Q180, R32, R37 (owner decisions of 2026-10-04)
- User Flows §6.2 (free shipping rule), §15 (shipping assignment and pricing)
- DB Design §9, "v1.2 TASK-009 Amendments"
- API Contract §16
- Permission catalog (`SHIPPING_VIEW`, `SHIPPING_MANAGE`)

## Scope
- `shipping_companies`, `shipping_rules` (on `governorates`/`areas`), setting `shipping.free_shipping_threshold`.
- `/admin/shipping/companies` and `/admin/shipping/rules` list, create, edit (status included), audited.
- Pure engine `quoteShipping`; `quoteShippingForArea` for checkout; `GET /shipping/options?areaId=` for the current cart.

## Non-Goals
- Calling the quote at checkout and snapshotting it on the order (TASK-029/030); assigning or changing the company on an order (`assign-shipping`, shipment tasks); editing the threshold with approval (TASK-057); dashboard and website UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_shipping_rules/`
- `src/server/modules/shipping/` (`engine.ts`, `shipping-service.ts`, `schemas.ts`), `src/server/modules/settings/settings.ts`, `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/shipping/**`, `src/app/api/v1/shipping/options/`
- Docs: Business Spec R37, DB Design "v1.2 TASK-027 Amendments", API Contract "TASK-027 Amendments", ADR-0033

## Business Rules
- Q121/Q126: only contracted companies; the system proposes, staff may change. R37.1: the customer pays one fee; changing the company does not change it.
- Q122: governorate/area + company + order value + configurable rules. R37.3: area beats governorate beats everywhere; priority breaks ties.
- Q123/Q124: free shipping on the total after discounts. R37.2: one store-wide threshold, 2500 EGP to start; changes need Owner/Admin approval (Q180, TASK-057).
- R37.4: no active rule for the area means no shipping (`SHIPPING_UNAVAILABLE`).

## API Changes
API Contract "TASK-027 Amendments".

## Database Changes
Migration `shipping_rules`. DB Design "v1.2 TASK-027 Amendments".

## Security / Authorization
Admin endpoints need `SHIPPING_VIEW` / `SHIPPING_MANAGE`; changes are audited. The quote takes only an area id and reads the cart server-side; fees and totals never come from clients. Inputs validated with zod.

## Acceptance Criteria
- Admin create/edit/list of companies and rules work with validation, unique case-insensitive company codes and audit entries.
- An area rule's governorate is filled in and kept consistent.
- The quote uses the most specific active rule of an active (or no) company, inside its band and period; no rule is `SHIPPING_UNAVAILABLE`.
- Shipping is free from the threshold on the cart total after the discount; the threshold setting is honoured.
- All required checks pass.

## Tests
- Unit `src/server/modules/shipping/engine.test.ts`: specificity, ties, bands, periods, threshold, no match.
- Integration `src/app/api/v1/admin/shipping/shipping-routes.int.test.ts`: permissions, companies (codes, status, audit), rules (validation, governorate consistency, audit, list), quote (no rule, specificity, inactive rule/company, discount below threshold, threshold setting, area validation).

## Edge Cases
- 3000 EGP discounted to 2400 EGP with a 2500 EGP threshold: not free (Q123).
- The proposed company is deactivated: its rules stop applying, less specific ones take over.
- Inactive area or governorate in the quote.
- Rule moved to an area of another governorate.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- Record R37 in `docs/decisions/business-rules-ledger.xlsx`.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
