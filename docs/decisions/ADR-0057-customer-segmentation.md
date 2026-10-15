# ADR-0057 — Customer Segmentation: Definitions Evaluated on Read, Consent First

- **Status:** Accepted (TASK-047)
- **Date:** 2026-10-15
- **Relates to:** ADR-0051 (marketing consent ledger), ADR-0052 (analytics aggregation); Business Spec Q59, Q140, Q141; User Flows §16.2; Architecture §17; API Contract §24, "TASK-047 Amendments"

## Context

Q141 sets the MVP segments (all opted-in, previous buyers, buyers by product/brand/category, inactive X days, high-spending) and asks for basic, configurable segmentation. Q140 requires every audience to satisfy marketing consent. Campaigns (TASK-048) need to pick a segment, and sending (TASK-049) needs the recipients at send time.

## Decision

1. **A segment is a definition, not a stored list.** `{ type, channel, …parameters }` (zod `segmentDefinitionSchema`) is evaluated on read against orders and the consent ledger. No table: TASK-048 keeps the definition on the campaign and resolves recipients with `segmentCustomerIds` when it needs them, so an opt-out is honoured up to that moment (User Flows §16.2).
2. **Consent first.** Every segment is the intersection of its condition with customers whose latest `marketing_consents` row for the channel is `OPTED_IN` (ADR-0051). There is no segment without a channel. Anonymized customers are excluded as well.
3. **Thresholds are parameters.** "Inactive X days" and the high-spend amount are given in each definition by staff (Q141 "configurable"); the server has no default value, so no business threshold is invented.
4. **Buyers use the analytics revenue statuses.** A buying order is one in `REVENUE_ORDER_STATUSES` (TASK-051; `CONFIRMED` to `DELIVERED`, owner decision 2026-10-15), so segment and revenue figures agree; spend is order line totals (after discounts, without shipping), as revenue in ADR-0052 (both decided by the owner on 2026-10-15).
5. **Preview returns a count only** (`POST /admin/segments/preview`, `MARKETING_VIEW`). Marketing staff do not get customer names or contacts from it (Q80 keeps contacts behind `VIEW_CUSTOMER_CONTACT`). POST is used because the definition carries id lists; the call changes nothing.

## Consequences

- Each preview runs one query over customers, consent and orders; fine at MVP volume. The count loads the ids (marked in code) and can become a `COUNT(*)` if audiences grow large.
- Changing the buyer statuses or the spend measure later changes every segment at once, together with analytics revenue.
- Advanced segmentation (combining conditions, saved segments) is left for later (Q141).
