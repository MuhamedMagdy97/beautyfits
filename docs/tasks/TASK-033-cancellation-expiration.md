# TASK-033 — Cancellation & Expiration

## Goal

A customer or authorized staff member can cancel an order until the carrier physically has the shipment; cancellation and expiry give back the order's stock, discount use and wallet hold in the same transaction, and the order is kept for history.

## Dependencies

TASK-030 (state machine, ADR-0036), TASK-031 (expiry, ADR-0037), TASK-032 (revisions, ADR-0038). TASK-034 (shipments) and TASK-036 (shipping cancellation flow) follow.

## Source of Truth

- Business Spec Q10, Q28, Q31, Q33, Q86, Q87, Q88, Q89, R3, R11, R16, R36, Audit Correction 5
- User Flows §8.3, §8.4, §12, §13.3
- DB Design "Order expiration/cancellation", "v1.2 TASK-033 Amendments"
- API Contract §15 "Cancellation window", "TASK-033 Amendments"
- Permission Catalog `CANCEL_ORDER`

## Scope

- `POST /orders/{orderId}/cancel` (customer, own order, optional reason).
- `POST /admin/orders/{orderId}/cancel` (`CANCEL_ORDER`, reason required).
- Shared `releaseOrderHolds` used by cancellation and the TASK-031 expiry job.
- `orders.cancelled_at`; `adminOrder.cancelledAt`; audit `ORDER_CANCELLED`; outbox `ORDER_CANCELLED`.

## Non-Goals

- Shipping cancellation request on the Shipment, `request-shipping-cancellation`, `SHIPPED → CANCELLED` after return (TASK-036; needs shipments from TASK-034).
- Sending notifications (TASK-045), dashboard and website UI (later phases).

## Files / Modules

- `src/server/modules/orders/orders.ts` (`CANCELLABLE_ORDER_STATUSES`, `releaseOrderHolds`), `orders-service.ts` (`cancelMyOrder`, `cancelOrder`), `cod-service.ts` (uses `releaseOrderHolds`), `schemas.ts`
- `src/server/modules/audit/audit.ts`
- `src/app/api/v1/orders/[orderId]/cancel/`, `src/app/api/v1/admin/orders/[orderId]/cancel/`
- `prisma/schema.prisma`, `prisma/migrations/20261008033000_order_cancellation/`
- Docs: ADR-0039, API Contract / DB Design "TASK-033 Amendments", roadmap status

## Business Rules

- R11, Q10, Q33, Q87: direct cancellation only in Pending Confirmation, New, Confirmed, Preparing, Ready for Shipment.
- Q86: staff need `CANCEL_ORDER` and a reason.
- Q28, R36, Audit Correction 5: cancellation and expiry release stock, discount use and wallet hold.
- R3, Q88, Q89: after pickup only a shipping cancellation request (TASK-036); the order stays `SHIPPED`.
- R16: guests cannot cancel online.
- Q31: expired and cancelled orders are kept.

## API Changes

API Contract "TASK-033 Amendments".

## Database Changes

Migration `20261008033000_order_cancellation` (`orders.cancelled_at`). DB Design "v1.2 TASK-033 Amendments".

## Security / Authorization

Customer endpoint needs a customer session and matches the order by `customer_id` (another's order is `404`). Admin endpoint needs `CANCEL_ORDER`. Reasons are trimmed and limited to 500 characters. The client sends no amounts; all releases are computed from server records. Logs carry ids only.

## Acceptance Criteria

- Cancellation succeeds from each of the five window statuses and releases stock, discount use and wallet hold once.
- `SHIPPED`, `DELIVERED`, `CANCELLED`, `EXPIRED` are refused with `ORDER_CANCELLATION_NOT_ALLOWED`; a shipped order stays shipped.
- History, audit and outbox record the actor and reason.
- The expiry job skips cancelled orders; expired orders cannot be cancelled.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/orders/cancel-routes.int.test.ts`: full release (stock, discount, wallet), every window status, refusals after pickup and for finished orders, expiry interplay, ownership/guest/validation, admin permission/reason/actor, admin refusal of shipped orders.
- Existing COD expiry tests cover the shared release helper.

## Edge Cases

- Cancel racing with expiry, COD confirmation, revision confirmation or a staff transition: all lock the order row first; the loser sees the new status.
- Cancel after the COD deadline but before the expiry job ran: the order is still `PENDING_CONFIRMATION` and is cancelled (it was never confirmed either way).
- An open revision of a cancelled order shows `EXPIRED`.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- None requiring a business decision. The `SHIPPED` customer path is a sequencing hand-off to TASK-036 (ADR-0039 §4), not an open rule.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
