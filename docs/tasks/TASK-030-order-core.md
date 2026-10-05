# TASK-030 — Order Core & Historical Snapshots

## Goal

Orders created by checkout can be read by their customer and by staff, move through the first staff steps of the state machine, and their historical facts can no longer change.

## Dependencies

TASK-029 (checkout creates orders, ADR-0035), TASK-013 (audit), TASK-012 (permissions).

## Source of Truth

- Business Spec Q46, Q80–Q84, Q184, Q185, R1–R4, R11, R16, R19, R34
- User Flows §8
- DB Design §8, §24, "v1.2 TASK-029 Amendments", "v1.2 TASK-030 Amendments"
- API Contract §15, "TASK-030 Amendments"

## Scope

- The order state machine and `changeOrderStatus` (lock, check, update, history) for every later transition.
- `GET /me/orders`, `GET /orders/{orderId}`; `GET /admin/orders`, `GET /admin/orders/{orderId}` with contact/cost masking.
- `confirm`, `start-preparing`, `mark-ready-for-shipment` with audit; `ORDER_CONFIRMED` outbox event.
- Database: `orders.confirmed_at`, `order_id` foreign keys of reservations, discount uses and wallet holds, immutability triggers.
- `/me/deactivate` refuses while an order is open (R34).

## Non-Goals

- COD confirmation and expiry (TASK-031), modification (TASK-032), cancellation (TASK-033), shipping and delivery (TASK-034+), guest order claim (TASK-010), UI.

## Files / Modules

- `src/server/modules/orders/` (`orders.ts`, `orders-service.ts`, `schemas.ts`)
- `src/app/api/v1/me/orders/`, `src/app/api/v1/orders/[orderId]/`, `src/app/api/v1/admin/orders/**`
- `prisma/migrations/*_order_core/`, `prisma/schema.prisma`
- `src/server/modules/customers/profile-service.ts` (R34), `src/server/modules/checkout/checkout-service.ts` (response builder moved), `src/server/modules/audit/audit.ts`
- `src/test/integration/orders.ts` (`bareOrder` for engine tests)
- Docs: ADR-0036, DB Design / API Contract "TASK-030 Amendments"

## Business Rules

- Q46, Q184, Q185: orders are served from snapshots; snapshots never change.
- R1, R2, R4, User Flows §8.3: one step at a time; `Pending Confirmation → New` only by the System; ready-for-shipment before shipped.
- Q82, Q83, R4: `CONFIRM_ORDER`, `START_PREPARING`, `MARK_READY_FOR_SHIPMENT`; R19: no approvals.
- Q80: contact data and costs by permission. R16: no online guest access. R34: no deactivation with an open order.

## API Changes

API Contract "TASK-030 Amendments".

## Database Changes

Migration `order_core`. DB Design "v1.2 TASK-030 Amendments".

## Security / Authorization

Customers only their own orders (404 otherwise); staff by permission, contact data and costs masked; transitions server-side with the row locked; all changes audited. Logs carry ids only.

## Acceptance Criteria

- Customers list and read only their own orders; later catalog changes do not show.
- Staff without `VIEW_CUSTOMER_CONTACT` / `VIEW_COST_PRICE` see no contact data / costs.
- `NEW → CONFIRMED → PREPARING → READY_FOR_SHIPMENT` with the right permissions, history, audit and the confirm event; other moves are `ORDER_STATE_INVALID`.
- The database rejects changes to snapshots and items and deleting orders; reservation, discount-use and wallet-hold rows need an existing order.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/admin/orders/orders-routes.int.test.ts`: customer list/detail/ownership/snapshot; admin permissions, masking, search and phone filter; transitions with history, audit, event, 403/404/409; immutability triggers and foreign key.
- Integration `src/app/api/v1/me/me-routes.int.test.ts`: deactivation refused with an open order.
- Unit `src/server/modules/orders/orders.test.ts`: the transition graph.
- Existing engine tests now create real orders (`bareOrder`).

## Edge Cases

- Confirming twice: the second is `ORDER_STATE_INVALID`.
- A guest order may be linked to an account once; it can never be moved to another account.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- None. TASK-032 must amend `orders_immutable` explicitly if a confirmed revision changes the order's amounts (ADR-0036 §4).

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
