# TASK-044 — Verified Reviews

## Goal

Customers review products they received: one review per successful order and product, published immediately after the automated checks, shown at product level; moderators hide and restore reviews while the moderation history is kept.

## Dependencies

TASK-030 (orders, order items), TASK-014 (products and variants). TASK-034 adds delivery: until it lands no order reaches `DELIVERED`, so no review can be created in a running system (tests set the status directly).

## Source of Truth

- Business Spec Q3, Q11, Q12, Q49, Q50, Q171, Q172, Q173, Q174, C6
- User Flows §5
- DB Design §16, "Review granularity", "v1.2 TASK-044 Amendments"
- API Contract §20, "Review moderation", "TASK-044 Amendments"
- Permission Catalog `REVIEW_MODERATE`

## Scope

- Tables `reviews`, `review_moderation_history`, `review_reports` with delete/append-only triggers.
- `POST /orders/{orderId}/items/{orderItemId}/review`, `PATCH /reviews/{reviewId}`, `POST /reviews/{reviewId}/report`, `GET /products/{productId}/reviews`.
- `GET /admin/reviews`, `POST /admin/reviews/{reviewId}/hide`, `POST /admin/reviews/{reviewId}/restore` (`REVIEW_MODERATE`).
- Audit actions `REVIEW_CREATED`, `REVIEW_UPDATED`, `REVIEW_REPORTED`, `REVIEW_HIDDEN`, `REVIEW_RESTORED`.

## Non-Goals

- Review media (Q172), delivery (TASK-034), rate limits and content filters (open decisions, TASK-061), review UI (website/dashboard tasks), notifications to the author.

## Files / Modules

- `src/server/modules/reviews/reviews-service.ts`, `schemas.ts`
- `src/app/api/v1/products/[productId]/reviews/`, `orders/[orderId]/items/[orderItemId]/review/`, `reviews/[reviewId]/`, `reviews/[reviewId]/report/`, `admin/reviews/`, `admin/reviews/[reviewId]/hide/`, `admin/reviews/[reviewId]/restore/`
- `src/server/modules/audit/audit.ts` (actions, entity `REVIEW`)
- `prisma/schema.prisma`, `prisma/migrations/20261008044000_reviews/`
- Docs: ADR-0042, API Contract / DB Design "TASK-044 Amendments", roadmap status

## Business Rules

- Q3, Q12, Q49: verified purchase required; one review per successful order and product; each later successful order may add another.
- Q11, Q50, Q173: publish immediately after automated checks; edits are rechecked, no manual approval.
- Q171: rating 1–5 plus written text. Q172: no media.
- Q174: hiding keeps the review, its reason and the history; nothing is hard-deleted.
- C6: displayed at product level; the order item names the purchased variant.

## API Changes

API Contract "TASK-044 Amendments".

## Database Changes

Migration `20261008044000_reviews`. DB Design "v1.2 TASK-044 Amendments".

## Security / Authorization

Customer endpoints need a customer session; foreign orders, items and reviews are `404`. Moderation needs `REVIEW_MODERATE` and is audited with the employee and reason. The public list shows no customer data. All writes are transactional with their audit entry; moderation and edits lock the review row.

## Acceptance Criteria

- Only the customer of a `DELIVERED` order can review a product of it, once per order and product; the race loser gets `CONFLICT`.
- Published reviews appear in the product's public list with count and average; hidden ones do not.
- The author can edit; status is kept; the edit is audited with previous and new values.
- A customer reports a published review once; hiding resolves open reports.
- Hide (reason required) and restore keep a history row and audit entry; repeating is `CONFLICT`; reviews and history cannot be deleted.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/reviews/reviews-routes.int.test.ts`: creation and eligibility (state, ownership, guest orders, foreign items, validation, duplicates across variants, second order), public list (summary, locale, unpublished product), edit (author only, audit), reports (once, hidden), moderation (permission, reason, history, conflicts, edit keeps hidden, restore, audit trail, delete/update triggers).

## Edge Cases

- Two shades of one product in one order: one review.
- Two submissions at once: the unique index decides, the other gets `CONFLICT` with the review id.
- Archived or disabled product: existing reviews stay; the public list is `404` until it is published again.
- Customer deactivation (R34) anonymizes the profile; reviews stay and never named the customer.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- **Conflict reported:** DB Design §16 says "one review per successful purchase/order item"; Business Spec Q12/Q49 and User Flows §5 say one per order for the product. Implemented per the higher documents (unique order + product); DB Design amended.
- [BUSINESS DECISION REQUIRED] What counts as a "successful purchase"? Implemented as order status `DELIVERED`. Should a later full/partial customer return (TASK-037/038) remove eligibility or hide an existing review?
- [BUSINESS DECISION REQUIRED] Automated abuse checks: beyond verified purchase, ownership, one per order/product, rating 1–5 and non-blank text (max 2000 characters, a technical bound), which content checks apply (banned words, links, phone numbers, repeated text)? None are applied yet.
- [BUSINESS DECISION REQUIRED] Rate-limit thresholds for review create/edit and report (Security Requirements §6 lists them; TASK-061 / owner). Not applied yet.
- [BUSINESS DECISION REQUIRED] Reviewer display on the public list (none, first name, initials). Currently no name is shown.
- [BUSINESS DECISION REQUIRED] Edit window/limit for reviews (none defined; edits always allowed) and whether moderators can dismiss reports without hiding (currently only hiding resolves reports).

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
