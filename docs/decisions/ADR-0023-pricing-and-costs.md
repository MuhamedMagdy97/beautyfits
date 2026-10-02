# ADR-0023 — Selling prices and costs

- **Status:** Accepted (TASK-018); the decisions in §4 taken by the product owner on 2026-10-02
- **Date:** 2026-10-02
- **Relates to:** ADR-0011 (money), ADR-0016 (permissions), ADR-0017 (settings), ADR-0018 (audit logs), ADR-0019 (variants), ADR-0022 (publish requirements); Business Spec Q73, Q74, Q80, Q102, Q103, Q111, C1, C6, R9, R18, R19; User Flows §17.2; DB Design §5 `product_variants`; API Contract §13 and "TASK-018 Amendments"; permission catalog §1

## 1. Data

Columns on `product_variants` (C6: price and cost live on the variant), integer piastres:

| Column | Meaning | Changed by |
|---|---|---|
| `selling_price` | Tax-inclusive price customers pay (C1). Null until set; positive; once set never cleared (trigger `product_variants_price_kept`). | Price review (§2), or a price given when the variant is created |
| `latest_purchase_cost` | Unit cost of the latest goods receipt; basis for margins and warnings (Q103). | Opening cost (§3); goods receipts (TASK-023) |
| `weighted_average_cost` | Inventory valuation and COGS basis (Q103). | Opening cost (§3); goods receipts (TASK-023) |
| `currency` | Always `EGP` (check constraint, ADR-0011). | — |
| `first_goods_receipt_at` | Set by the first goods receipt (TASK-023); from then on costs are not typed by hand. | TASK-023 |

Check constraints keep prices positive and costs not negative. Each sale stores its own `unit_cost_at_sale` (orders tasks), so later purchases never change historical profit (Q103).

`nextWeightedAverageCost(onHand, average, received, unitCost)` in `src/server/modules/catalog/pricing.ts` is the weighted average formula for TASK-023, rounded once HALF-UP (R9). How negative on-hand stock is treated is left to TASK-023; the helper refuses it.

## 2. Price review (Q111)

`POST /admin/products/{id}/price-review` (`EDIT_PRODUCT_PRICE`, Q73) takes, per variant, either a `sellingPrice` or a `targetMarginBasisPoints`:

- **Margin** is on the selling price: `(price − cost) / price`, cost = latest purchase cost, on the tax-inclusive price as stored. Values are basis points (1 bp = 0.01%) so everything stays an exact integer.
- **Suggestion** from a target margin: `cost / (1 − margin)`, rounded HALF-UP to the piastre. Needs a known cost (`COST_UNKNOWN`) above zero (`PRICE_SUGGESTION_UNAVAILABLE`).
- **Warnings** (never blocking): `PRICE_NOT_ABOVE_COST` when price ≤ cost, `BELOW_MINIMUM_MARGIN` when the margin is below the setting `pricing.min_margin_basis_points`. Compared exactly, not on the rounded margin.
- `apply: false` (default) only previews; `apply: true` saves every changed price in one transaction under the product lock, with one `PRODUCT_VARIANT_PRICE_CHANGED` audit entry per changed variant (previous and new price, target margin when used, reason, request id). Unchanged prices are skipped.
- The system never changes a price on its own; a cost change only shows up as a warning at the next review.

**Cost visibility.** Margins and warnings reveal the cost, so they are returned only to callers with `VIEW_COST_PRICE`, and a target margin needs it too (`403`). Without it the review still sets prices by hand.

## 3. Costs by hand

`PATCH /admin/variants/{id}/cost` (`EDIT_COST_PRICE`, Q74) sets `latestPurchaseCost` and/or `weightedAverageCost` with a required reason, audited as `PRODUCT_VARIANT_COST_CHANGED`. Refused with `COSTS_LOCKED` once `first_goods_receipt_at` is set: from then on purchasing alone changes costs. Cost values are not written to application logs; the audit entry holds them (audit entries are visible to `VIEW_AUDIT_LOGS` holders, Owner/Admin by default, Q79).

Admin product and variant responses carry a `costs` object (`latestPurchaseCost`, `weightedAverageCost`, `marginBasisPoints`, `costsEditable`) only for callers with `VIEW_COST_PRICE`; every route passes its view through `src/server/modules/catalog/presentation.ts`.

## 4. Decisions by the product owner (2026-10-02)

1. **A price change applies directly** for anyone with `EDIT_PRODUCT_PRICE`, after the review shows the suggestion, margin and warnings. No approval request (R19 keeps approvals out of the catalog).
2. **Margin warning** below a configurable minimum margin, **default 10%** (`pricing.min_margin_basis_points = 1000`), and always when the price is at or below cost. Warnings do not block.
3. **Margin on price**: `(price − cost) / price`, on the tax-inclusive price as stored (no VAT removal in v1, C1).
4. **Costs typed by hand only as opening values**, before the variant's first goods receipt; afterwards only purchasing changes them. A reason is required.
5. **A selling price is at least 0.01 EGP**. A variant added to a published product needs a price (`SELLING_PRICE_REQUIRED`), and a price is never cleared, so a published product is always fully priced. Publishing needs a price on every active variant (`SELLING_PRICE`, added to ADR-0022 §2).

## 5. Technical defaults

1. A price may be given when a variant (or a product's default variant) is created; the route then also requires `EDIT_PRODUCT_PRICE`.
2. One price review covers at most 100 variants of one product (the variant limit).
3. The minimum margin setting accepts 0 to 9999 basis points; changing it comes with the settings screen (TASK-057), which decides whether it is a critical setting.
4. No price history table: the audit log holds every price and cost change with its actor, reason and request id.

## Consequences

- Migration `variant_pricing` (five columns, three check constraints, one trigger).
- New setting `pricing.min_margin_basis_points`, inserted by the bootstrap.
- New audit action codes `PRODUCT_VARIANT_PRICE_CHANGED`, `PRODUCT_VARIANT_COST_CHANGED`.
- No new dependency.
