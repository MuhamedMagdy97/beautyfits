# TASK-018 — Pricing & Cost Model

## Goal
Every variant carries a selling price, a latest purchase cost and a weighted average cost. Staff with the right permission set the selling price (by hand or from a target margin suggestion), cost values stay hidden from anyone without `VIEW_COST_PRICE`, every price and cost change is audited, and a product cannot be published while an active variant has no selling price.

## Dependencies
TASK-014 (variants), TASK-017 (publish checks in `checkPublishable`), TASK-012 (permissions), TASK-013 (audit log), TASK-005 (money helpers, ADR-0011). Used by TASK-019/TASK-023 (goods receipts update latest purchase cost and weighted average cost with the helpers added here), the cart/checkout tasks (current selling price, `PRICE_CHANGED`), orders (`unit_price`, `unit_cost_at_sale`) and analytics (`VIEW_PROFIT`).

## Source of Truth
- Business Spec Q73, Q74, Q80, Q102, Q103, Q111, C1 (tax-inclusive prices), C6 (price/cost at variant level), R9 (HALF-UP rounding), R18, R19
- User Flows §17.2
- DB Design §1 principle 3, §5 `product_variants`, §12 audit (price changes), "v1.2 TASK-014 Amendments"
- API Contract §13 (`PATCH /admin/variants/{variantId}/cost`, `POST /admin/products/{productId}/price-review`, "Cost fields are returned only to callers with `VIEW_COST_PRICE`")
- Permission catalog §1 (`EDIT_PRODUCT_PRICE`, `VIEW_COST_PRICE`, `EDIT_COST_PRICE`), §3
- ADR-0011 (money), ADR-0022 §2 (publish requirements)

## Scope
- Columns `selling_price`, `latest_purchase_cost`, `weighted_average_cost` (+ currency) on `product_variants`, nullable until set, integer piastres.
- `POST /admin/products/{productId}/price-review`: per variant, set a manual selling price or compute a suggestion from a target margin; returns the margin and any margin warning.
- `PATCH /admin/variants/{variantId}/cost`: edit cost values within the rules decided below.
- Cost fields in admin product/variant responses only for `VIEW_COST_PRICE`; selling price for every `PRODUCT_VIEW` caller.
- Publish requirement `SELLING_PRICE` (every active variant has a selling price) in `checkPublishable`; a variant added to a published product needs a price, and a price is never cleared.
- A price may be given when a product or variant is created (also needs `EDIT_PRODUCT_PRICE`).
- Setting `pricing.min_margin_basis_points` (default 10%).
- Pure pricing helpers in `src/server/modules/catalog/pricing.ts`: margin, suggested price from target margin, weighted average cost update (for TASK-023), margin warning — all with ADR-0011 money helpers, rounded once HALF-UP.
- Audit entries `VARIANT_PRICE_CHANGED`, `VARIANT_COST_CHANGED` with previous/new values and reason.

## Non-Goals
- Goods receipts and the actual purchase-driven cost updates (TASK-019, TASK-023); this task only provides the calculation.
- Discounts, coupons, compare-at/"was" prices (marketing/discount tasks).
- Cart repricing and `PRICE_CHANGED` handling (TASK-025+).
- `unit_cost_at_sale` on order items (orders tasks).
- Profit/COGS reports (`VIEW_PROFIT`, analytics tasks).
- Tax engine (C1: prices are tax-inclusive, no tax calculation in v1).
- Public catalog endpoints (TASK-052+, TASK-058+).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_variant_pricing/`
- `src/server/modules/catalog/` (new `pricing.ts`, `pricing-service.ts`, `presentation.ts`; `lifecycle.ts`, `products-service.ts`, `product-guards.ts`, `schemas.ts`)
- `src/server/modules/settings/settings.ts` (new setting)
- Existing admin product/variant routes (cost visibility, price permission at creation)
- `src/app/api/v1/admin/products/[id]/price-review/route.ts`, `src/app/api/v1/admin/variants/[id]/cost/route.ts`
- `src/server/modules/audit/audit.ts` (new action codes)
- Docs: DB Design "v1.2 TASK-018 Amendments", API Contract "TASK-018 Amendments", ADR-0023

## Business Rules
- Q73: selling price changes need `EDIT_PRODUCT_PRICE`, separate from `PRODUCT_EDIT`; in no default role (R18 list).
- Q74 / Q80: cost is sensitive; seen with `VIEW_COST_PRICE`, edited with `EDIT_COST_PRICE` (Owner/Admin + Inventory Manager by default).
- Q102: each purchase keeps its own unit cost; a new cost that reduces margin raises a selling-price review warning.
- Q103: latest purchase cost for display and warnings; weighted average cost for valuation/COGS; unit cost stored at sale.
- Q111: manual price or target margin → system suggestion → Owner reviews; never an automatic price overwrite; warning when cost changes materially.
- C1: selling prices are tax-inclusive. R9: exact arithmetic, HALF-UP to the piastre.

## API Changes
API Contract "TASK-018 Amendments".

## Database Changes
Migration `variant_pricing`. DB Design "v1.2 TASK-018 Amendments".

## Security / Authorization
`EDIT_PRODUCT_PRICE` for price changes, `EDIT_COST_PRICE` for cost edits, `VIEW_COST_PRICE` to see costs and margins (margin reveals cost). All server-side; cookie writes need the `Origin` check. Every change audited with actor, previous and new values, reason and request id. Cost values never logged outside the audit entry.

## Acceptance Criteria
- A price review previews by default and saves with `apply: true`; each changed price writes one audit entry with actor, previous and new price, reason and request id; unchanged prices write nothing.
- A target margin suggests `cost / (1 − margin)` from the latest purchase cost, rounded HALF-UP; it is refused without a cost or without `VIEW_COST_PRICE`.
- Warnings `PRICE_NOT_ABOVE_COST` and `BELOW_MINIMUM_MARGIN` (setting, default 10%) are shown and never block.
- Costs, margins and warnings are returned only to callers with `VIEW_COST_PRICE`.
- Opening costs can be typed with a reason until the first goods receipt, then they are refused (`COSTS_LOCKED`).
- Publishing needs a price on every active variant; a published product cannot get an unpriced variant; a price is never cleared or set to 0 or below.
- Each endpoint requires its permission; cookie writes need the `Origin` check; all required checks pass.

## Tests
- Unit `pricing.test.ts`: margin, suggestion from target margin, WAC update, warnings, HALF-UP rounding, edge values.
- Unit `lifecycle.test.ts`: `SELLING_PRICE` publish requirement.
- Integration / route tests: 401/403 per endpoint, Origin check, cost hidden without `VIEW_COST_PRICE`, audit entries, publish refused without price, published-product price guards, archived product read-only.

## Edge Cases
- Cost known, price not set (draft) and the reverse.
- Price equal to or below cost.
- Target margin of 0% or ≥ 100% (impossible suggestion).
- Very large amounts (above `Number.MAX_SAFE_INTEGER` → refused at the edge).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
The source documents left five points open; the product owner decided them on 2026-10-02 (ADR-0023 §4):
1. **Q111 "Owner reviews/approves"**: a price change applies directly for anyone with `EDIT_PRODUCT_PRICE`, after the review shows suggestion, margin and warnings. No approval request.
2. **Margin warning**: below a configurable minimum margin, default **10%**, and always when the price is at or below cost. Never blocking.
3. **Margin definition**: on the selling price, `(price − cost) / price`, on the tax-inclusive price as stored.
4. **Manual costs**: opening values only, before the first goods receipt; reason required.
5. **Prices**: at least 0.01 EGP; a variant added to a published product needs a price.

Technical defaults: ADR-0023 §5.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
