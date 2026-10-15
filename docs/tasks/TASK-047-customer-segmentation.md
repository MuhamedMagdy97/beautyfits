# TASK-047 — Customer Segmentation

## Goal

Marketing staff can define the MVP customer segments and see how many customers each one reaches on a channel, counting only customers who opted in to that channel; campaigns (TASK-048) reuse the same definitions.

## Dependencies

TASK-030 (orders), TASK-046 (marketing consent ledger), TASK-050/TASK-051 (revenue order statuses).

## Source of Truth

- Business Spec Q59, Q140, Q141, Q155
- User Flows §16.2
- Architecture §17 ("Segmentation starts simple and is built from first-party customer behavior/data")
- DB Design §18 note ("Do not treat an audience query as a consent substitute")
- API Contract §24, "TASK-047 Amendments"
- Permission catalog (`MARKETING_VIEW`); Security Requirements; Test Strategy rule 10
- ADR-0051, ADR-0052, ADR-0057

## Scope

- Segment definitions (`segmentDefinitionSchema`): `ALL_OPTED_IN`, `PREVIOUS_BUYERS`, `PRODUCT_BUYERS`, `BRAND_BUYERS`, `CATEGORY_BUYERS`, `INACTIVE` (`inactiveDays`), `HIGH_SPENDING` (`minSpent`, piastres), each with a `channel`.
- `segmentCustomerIds(db, segment, now)` for TASK-048/TASK-049.
- `POST /admin/segments/preview` (`MARKETING_VIEW`): audience size.

## Non-Goals

- Campaigns (TASK-048), delivery, frequency and fallback (TASK-049), saved or combined segments, customer lists in the preview, dashboard screens.

## Files / Modules

- `src/server/modules/customers/segments.ts`, `segments.test.ts`
- `src/app/api/v1/admin/segments/preview/route.ts`, `src/app/api/v1/admin/segments/segments-routes.int.test.ts`
- Docs: ADR-0057, API Contract "TASK-047 Amendments", permission catalog (`MARKETING_VIEW` row), roadmap

## Business Rules

- Q140: every segment satisfies marketing consent: latest ledger row for the channel is `OPTED_IN`.
- Q59 / Q155: consent is never inferred from orders, an account, an email or a phone; guests have none.
- Q141: the MVP segment list; "Inactive X days" and the high-spend amount are configurable per segment (parameters, no server default).
- User Flows §16.2: opt-out removes eligibility immediately (segments are evaluated on read).
- Anonymized (deactivated, R34) customers are never included.

## API Changes

API Contract "TASK-047 Amendments".

## Database Changes

None (no migration). Reads `customers`, `marketing_consents`, `orders`, `order_items`, `products`, `product_categories`, `categories`.

## Security / Authorization

Employee session with `MARKETING_VIEW`, checked server-side. Input validated with zod (UUIDs, whole days, whole piastres). Only a count is returned: no names or contacts. Read-only, so no audit log.

## Acceptance Criteria

- Each MVP segment returns the right customers, only those opted in to the channel; opted-out, other-channel-only and anonymized customers never count.
- Category segments include subcategories; buyers ignore cancelled, expired and unconfirmed orders (provisional statuses).
- High spend compares integer piastres of line totals, shipping excluded.
- `401` without session, `403` without `MARKETING_VIEW`, `400` for invalid definitions.
- All required checks pass.

## Tests

- Unit `src/server/modules/customers/segments.test.ts`: definition schema (channel, fields per type, whole days, whole piastres).
- Integration `src/app/api/v1/admin/segments/segments-routes.int.test.ts`: authz, validation, consent filtering, each segment type.

## Edge Cases

- Opted in then out: excluded (latest row wins).
- Unknown product/brand/category ids: count 0.
- A customer with only cancelled or `PENDING_CONFIRMATION` orders is not a buyer.
- A customer who never bought is not "inactive" (see open items).

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] Which order statuses make a customer a buyer (previous/product/brand/category buyers, inactivity, spend). Implemented: the provisional revenue statuses of TASK-051 (`NEW`, `CONFIRMED`, `PREPARING`, `READY_FOR_SHIPMENT`, `SHIPPED`, `DELIVERED`); unconfirmed COD, cancelled and expired orders excluded. Returned items are not deducted.
- [BUSINESS DECISION REQUIRED] "Inactive X days": activity is measured by buying orders only, and customers who never bought are not included (they are in "all opted-in"). Should sign-ins, views or never-buyers count?
- [BUSINESS DECISION REQUIRED] "High-spending": measured as lifetime merchandise spend (order line totals after discounts, shipping excluded, returns not deducted). Should it be over a period, include shipping, or deduct returns? Threshold is given per segment.
- [BUSINESS DECISION REQUIRED] Customers whose account is `SUSPENDED` or still `PENDING_VERIFICATION` but opted in: included today (only consent and anonymization are checked). Should they be excluded from marketing?
- Whether a message can actually be delivered (verified email, a phone) is checked at send time by TASK-049 (ADR-0051 §6), not by the segment.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
