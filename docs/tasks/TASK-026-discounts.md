# TASK-026 — Discount Engine

## Goal
Staff create percentage discounts (store-wide or for products, categories and brands, with optional minimum, cap, period and usage limits). Shoppers choose one discount for their cart, from listed offers or by code; the backend computes and rechecks it.

## Dependencies
TASK-018 (selling prices), TASK-025 (cart), TASK-015 (brands, categories), TASK-013 (audit).

## Source of Truth
- Business Spec Q38, Q125, Q131–Q138, R9, R36 (owner decisions of 2026-10-04)
- User Flows §6.2 (discount rules)
- DB Design §14
- API Contract §14, §23
- Permission catalog (`DISCOUNT_VIEW`, `DISCOUNT_MANAGE`)

## Scope
- `discounts`, `discount_products`, `discount_categories`, `discount_brands`, `discount_usages`, `carts.discount_id`.
- `/admin/discounts` list, create, edit, activate, deactivate (audited).
- Cart: `availableDiscounts`, `discount`, `discountProblem`, `discountTotal`, `total`; `PUT|DELETE /cart/discount`; `reprice` drops a discount that no longer applies.
- `recordDiscountUsage` / `releaseDiscountUsage` for checkout and cancellation.

## Non-Goals
- Recording uses at checkout (TASK-029) and releasing them (TASK-031/033); order discount snapshots and per-item allocation (TASK-030); suggested promotions (Q132, analytics tasks); fixed-amount discounts (Q131); dashboard and website UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_discounts/`
- `src/server/modules/discounts/` (`engine.ts`, `discounts-service.ts`, `schemas.ts`), `src/server/modules/cart/cart-service.ts`, `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/discounts/**`, `src/app/api/v1/cart/discount/`
- Docs: Business Spec R36, DB Design "v1.2 TASK-026 Amendments", API Contract "TASK-026 Amendments", ADR-0032

## Business Rules
- Q131 percentage only; Q132 product/category/brand/store-wide targets; Q133 optional minimum; Q134 optional cap; Q135 overall and per-customer limits.
- Q125/Q138: one discount per order, chosen by the customer, never chosen silently.
- Q38/Q136: rechecked; an invalid discount is removed, never trusted. Q137: unavailable products do not count.
- R9: HALF-UP rounding. R36: offers vs codes, targeted base with whole-subtotal minimum, subcategories, guest limits, usage counting and release, 1–100%, edits any time.

## API Changes
API Contract "TASK-026 Amendments".

## Database Changes
Migration `discounts`. DB Design "v1.2 TASK-026 Amendments".

## Security / Authorization
Admin endpoints need `DISCOUNT_VIEW` / `DISCOUNT_MANAGE`; changes are audited. The cart never accepts amounts or percentages from clients. Coded discounts are not listed and cannot be chosen by id; unknown codes are throttled per IP. Usage limits are enforced under a row lock. Inputs validated with zod.

## Acceptance Criteria
- Admin create/edit/activate/deactivate/list work with validation, unique case-insensitive codes and audit entries.
- Cart lists applicable codeless offers without applying them; choosing by id or code applies one discount with the right amount; ineligible choices are refused with a reason.
- Targeting by product, brand and category (with subcategories) is correct; minimum, cap, period, overall and per-customer limits are enforced; guests are refused per-customer-limited discounts.
- A chosen discount that stops applying is shown as a problem and removed by reprice.
- Concurrent uses never exceed the overall limit; release gives a use back.
- All required checks pass.

## Tests
- Unit `src/server/modules/discounts/engine.test.ts`: amount, rounding, cap, targeting, minimum, every refusal reason, subcategory expansion.
- Integration `src/app/api/v1/admin/discounts/discounts-routes.int.test.ts`: admin permissions, create/validation/codes, edit and status with audit, list filters and usage counts; cart offers and choice, codes and throttling, targeting, refusals, recheck and reprice, limits with release, concurrency, merge.

## Edge Cases
- Discount ends, is deactivated or its minimum stops being met after it was chosen.
- Coded discount chosen by id; wrong codes repeated from one IP.
- Two orders racing for the last use of a limited discount.
- Targeted product unavailable while other targets remain.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- Record R36 in `docs/decisions/business-rules-ledger.xlsx` (after PR #31, which adds R32–R35, is merged).

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
