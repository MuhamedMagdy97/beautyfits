# TASK-037 — Customer Return Requests

## Goal

Customers ask to return some or all items of a delivered order within the 14-day window, with a free-text reason and photos where required; the request waits in `Pending Approval` for staff, as its own lifecycle separate from the order and shipment.

## Dependencies

TASK-030 (orders), TASK-034 (`DELIVERED`, `orders.delivered_at`), TASK-016 (uploads, ADR-0021), TASK-009 (deactivation open-items check).

## Source of Truth

- Business Spec Q5, Q14, Q17, Q34, Q90–Q92, Q99, Q100, R20, R21, R34
- User Flows §11.1–§11.3
- Architecture §14, §20
- DB Design §12, "v1.2 TASK-037 Amendments"
- API Contract §17 (customer), §28, "TASK-037 Amendments"
- Permission catalog (`RETURNS_VIEW`)

## Scope

- `returns`, `return_items`, `return_evidence`; media purpose `RETURN_EVIDENCE`, `media_assets.created_by_customer_id`.
- `POST /orders/{orderId}/returns`, `GET /me/returns`, `GET /returns/{returnId}`, `POST /returns/{returnId}/evidence`, `POST /returns/{returnId}/resubmit`, `POST /returns/{returnId}/cancel`.
- Customer uploads of `RETURN_EVIDENCE` through `/files/upload-init`, `PUT /files/uploads/{id}`, `/files/complete`.
- `GET /admin/returns`, `GET /admin/returns/{returnId}` (`RETURNS_VIEW`), so staff can see waiting requests.
- Open returns block deactivation (R34).

## Non-Goals

- Approve/reject, pickup, receive, inspection, refunds (TASK-038–041); return status history (TASK-038); notifications; UI.

## Files / Modules

- `src/server/modules/returns/returns.ts`, `returns.test.ts`, `returns-service.ts`, `schemas.ts`
- `src/server/modules/media/uploads-service.ts`, `schemas.ts`; `src/app/api/v1/files/upload-init|complete/route.ts`
- `src/server/modules/customers/profile-service.ts`, `src/server/modules/audit/audit.ts`
- `src/app/api/v1/orders/[orderId]/returns/`, `src/app/api/v1/returns/**`, `src/app/api/v1/me/returns/`, `src/app/api/v1/admin/returns/**`
- `prisma/schema.prisma`, `prisma/migrations/20261014037000_return_requests/`
- Docs: ADR-0049, API / DB "TASK-037 Amendments", roadmap

## Business Rules

- Q90: the order stays `DELIVERED`; the return is a separate lifecycle.
- Q17, R21: requests until the end of the 14th calendar day after the delivery date, Africa/Cairo (delivery day = day 0).
- Q34: partial returns per order line and quantity.
- Q14, Q99: free-text reason required; final assessment is separate (later tasks).
- Q100: photos required for damage / wrong-item cases, optional otherwise; attached to the return.
- Q91: new requests are `PENDING_APPROVAL`. Q92: a rejected request is never rewritten; the customer submits a new one.
- R34: open returns block deactivation.

## API Changes

API Contract "TASK-037 Amendments".

## Database Changes

Migration `20261014037000_return_requests`; DB Design "v1.2 TASK-037 Amendments".

## Security / Authorization

Customer endpoints need an active customer session and act only on the customer's own orders and returns (others: `404`). Evidence must be the customer's own checked upload. Staff reads need `RETURNS_VIEW`; evidence files are served to staff with `RETURNS_VIEW`. Customer uploads are rate limited. Every change is audited in the same transaction. Logs carry ids only.

## Acceptance Criteria

- A customer can request a partial return of their delivered order inside the window; outside it `422 RETURN_WINDOW_EXPIRED`; undelivered `409 ORDER_STATE_INVALID`.
- Units already in a live return cannot be requested again; withdrawn or rejected ones can.
- `DAMAGED` / `WRONG_ITEM` need at least one photo; photos must be the customer's own `SAFE` uploads, used once.
- Withdraw and add photos only while `PENDING_APPROVAL`; resubmit only from `REJECTED`, leaving it unchanged.
- The order status never changes; returns are never deleted.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/returns/returns-routes.int.test.ts`: request/partial/quantity limits, window, ownership and validation, evidence rules and uploads, staff evidence access, cancel/resubmit, deactivation block, admin reads, delete triggers.
- Unit `src/server/modules/returns/returns.test.ts`: window end and quantity check.

## Edge Cases

- Two concurrent requests for the same units: the order row lock serializes them; the second gets `RETURN_QUANTITY_EXCEEDED`.
- An order line listed twice in one request: `400`.
- A photo still `PENDING` or `REJECTED`: `409 CONFLICT` (`MEDIA_NOT_READY`).

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] Claim categories: Q100 needs to know whether a case is "damage / wrong item". Implemented as a customer-chosen `claimType` (`DAMAGED`, `WRONG_ITEM`, `OTHER`); photos required for the first two. Are these the right categories (e.g. separate "defective", "expired", "missing item")?
- [BUSINESS DECISION REQUIRED] Guest orders: customer return endpoints need an account, so guest orders cannot be returned through the API (R16 gives guests no order access). Should support staff create returns for guest orders, and with which permission?
- [BUSINESS DECISION REQUIRED] Evidence limits: at most 10 photos per return and 30 customer uploads per hour are technical defaults; images must be at least 500 × 500 px like product images. Confirm, and decide whether videos are needed.
- [BUSINESS DECISION REQUIRED] Should customers be able to view/download their own evidence photos (currently staff only) and add photos after approval?
- [BUSINESS DECISION REQUIRED] Items not eligible for return (e.g. hygiene/opened cosmetics, free gifts): no rule exists, so every delivered line is returnable; inspection decides the outcome (Q98, R7).
- Note: no `Idempotency-Key` on return creation (not required by API §17); the quantity check bounds duplicates (ADR-0049 §2).

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
