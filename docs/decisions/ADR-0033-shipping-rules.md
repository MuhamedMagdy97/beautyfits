# ADR-0033 — Shipping Rules and Free Shipping

- **Status:** Accepted (TASK-027); the rules (Business Spec R37) were decided by the product owner on 2026-10-04
- **Date:** 2026-10-04
- **Relates to:** ADR-0030 (locations), ADR-0031 (cart), ADR-0032 (discounts), ADR-0017 (settings); Business Spec Q6, Q121–Q126, Q180, R32, R37; User Flows §6.2, §15; DB Design §9 and "v1.2 TASK-027 Amendments"; API Contract §16 and "TASK-027 Amendments"

## 1. Model

- `shipping_companies`: the contracted set (Q121). `shipping_rules`: a fee for a place (everywhere, a governorate or an area of the managed location list, R32), an optional order-total band `[min, max)`, an optional period `[from, to)`, a `priority` and an optional proposed company.
- Both have `status` (`ACTIVE`/`INACTIVE`) and are never deleted (triggers); orders will snapshot the rule they used (`shipping_rule_snapshot_json`, TASK-030). Every change is audited (`SHIPPING_*`).

## 2. Engine

- `quoteShipping` (`src/server/modules/shipping/engine.ts`) is pure. Among the matching rules the most specific place wins (area > governorate > everywhere), then the higher priority, then the lower fee, then the id. Specificity beats priority (R37).
- No match: no quote, `SHIPPING_UNAVAILABLE` (R37). This also applies above the free-shipping threshold.
- Free shipping: one store-wide threshold, setting `shipping.free_shipping_threshold` (default 250000 piastres), compared with the total after discounts (Q123, Q124). Rules have no free-shipping flag; a fee of 0 serves a free area.
- `quoteShippingForArea(db, …)` loads the active rules of active (or no) companies and the threshold; checkout (TASK-029) calls it in its transaction with the area of the delivery address.

## 3. Customer quote

- `GET /shipping/options?areaId=` quotes the current cart's `total`. The customer sees one fee and never picks a carrier; the rule's company is a proposal that staff can change later without changing the fee (Q126, R37).

## Consequences

- Migration `shipping_rules`: enum `shipping_status`; tables `shipping_companies`, `shipping_rules`; checks and no-delete triggers.
- Changing the threshold needs Owner/Admin approval (Q180); the settings screen with approvals is TASK-057. Until then the default applies.
- No new dependency.
