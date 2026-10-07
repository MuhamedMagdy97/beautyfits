# TASK-034 — Shipment & Tracking Core

## Goal

Staff choose the carrier, hand the order to it (stock consumed, wallet credit spent), record tracking and deliver it; customers and staff see the shipment, kept separate from the order status.

## Dependencies

TASK-030 (order state machine, ADR-0036), TASK-020 (`commitForOrder`), TASK-028 (`captureWalletReservation`), TASK-027 (shipping companies).

## Source of Truth

- Business Spec Q84, Q85, Q126, Q127, R2, R4, R37, R38.7
- User Flows §8.2, §8.3
- DB Design §9, §22, §23 "Delivery confirmation", "v1.2 TASK-034 Amendments"
- API Contract §15, §16, §31, "TASK-034 Amendments"
- Permission catalog (`ASSIGN_SHIPPING`, `MARK_AS_SHIPPED`, `MANAGE_SHIPMENT`, `MARK_AS_DELIVERED`)

## Scope

- `shipments` / `shipment_events`, `orders.delivered_at`.
- `POST /admin/orders/{orderId}/assign-shipping`, `POST /admin/orders/{orderId}/mark-shipped`.
- `POST /admin/shipments/{shipmentId}/tracking`, `POST /admin/shipments/{shipmentId}/status` (`OUT_FOR_DELIVERY`, `DELIVERED`).
- Shipments in `adminOrder` and `customerOrder`; audit entries; `ORDER_SHIPPED` / `ORDER_DELIVERED` outbox events.

## Non-Goals

- Delivery failures, attempts and contact tasks (TASK-035); shipping cancellation request, return to sender, returned (TASK-036); carrier webhooks; notifications (TASK-045, from the outbox); UI.

## Files / Modules

- `src/server/modules/shipping/shipments.ts`, `shipments-service.ts`, `schemas.ts`, `shipments.test.ts`
- `src/server/modules/orders/orders-service.ts` (reads), `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/orders/[orderId]/assign-shipping|mark-shipped/`, `src/app/api/v1/admin/shipments/**`
- `prisma/schema.prisma`, `prisma/migrations/20261008034000_shipments/`
- Docs: ADR-0040, API / DB "TASK-034 Amendments", roadmap

## Business Rules

- Q84, R4: `READY_FOR_SHIPMENT → SHIPPED` with `MARK_AS_SHIPPED` at actual handoff; tracking when available.
- ADR-0025, R38.7: shipping consumes the held stock and captures the held wallet credit.
- Q126, R37: staff change the carrier within the active contracted companies; the fee does not change.
- R2, User Flows §8.2: shipment `SHIPPED → OUT_FOR_DELIVERY → DELIVERED`; delivery also moves the order to `DELIVERED` (API §16).
- Q85: manual updates now, carrier integration later.

## API Changes

API Contract "TASK-034 Amendments".

## Database Changes

Migration `20261008034000_shipments`; DB Design "v1.2 TASK-034 Amendments".

## Security / Authorization

Every endpoint needs its permission; `DELIVERED` additionally `MARK_AS_DELIVERED`. Order and shipment rows are locked (order first) and transitions checked server-side. All changes audited. Customers see only their own orders' shipments, without staff notes or locations. Logs carry ids only.

## Acceptance Criteria

- Handoff moves the order, commits stock, captures the wallet hold and creates the shipment atomically; without an active company nothing changes.
- The carrier can be changed until handoff only; inactive/unknown companies are refused.
- Tracking is unique per company and can be corrected; events are append-only and shipments never deleted.
- `OUT_FOR_DELIVERY` before `DELIVERED`; `DELIVERED` needs `MARK_AS_DELIVERED`, moves the order and sets `delivered_at`.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/admin/shipments/shipments-routes.int.test.ts`: full flow (stock, wallet, events, audit, outbox, customer tracking), refusals and rollback, tracking uniqueness, permissions, triggers.
- Unit `src/server/modules/shipping/shipments.test.ts`: the shipment graph.

## Edge Cases

- Shipping twice: `ORDER_STATE_INVALID`. An order without wallet use or with nothing held: commit/capture do nothing.
- The checkout-proposed company may have been deactivated since: handoff is refused until staff assign an active one.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] Delivery time: delivery is recorded at the moment staff enter it (manual MVP). The return window runs from the actual delivery date (R21); should staff be able to enter an earlier actual delivery time (back-dating), and with which limit/permission? Not implemented.
- [BUSINESS DECISION REQUIRED] Out for Delivery step: the manual flow requires `OUT_FOR_DELIVERY` before `DELIVERED` (User Flows §8.2). If staff often learn of a delivery only afterwards, should `SHIPPED → DELIVERED` be allowed directly? Kept strict.
- Note: shipment rows start at handoff; DB Design §9 `PENDING`/`READY` are represented by the order's `READY_FOR_SHIPMENT` (ADR-0040 §1, technical representation only).

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
