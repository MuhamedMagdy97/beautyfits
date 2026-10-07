# ADR-0040 — Shipments, Carrier Handoff and Delivery

- **Status:** Accepted (TASK-034)
- **Date:** 2026-10-07
- **Relates to:** ADR-0025 (reservations, commit at shipping), ADR-0034 (wallet capture), ADR-0036 (order state machine), ADR-0033 (shipping companies); Business Spec Q84, Q85, Q126, Q127, R2, R4, R37, R38.7; User Flows §8.2, §8.3; API §16 and "TASK-034 Amendments"; DB Design §9 and "v1.2 TASK-034 Amendments"

## 1. Shipment rows start at carrier handoff

A `shipments` row is created by `mark-shipped`, the moment the carrier physically takes the parcel (R4). Before that, the order's own `READY_FOR_SHIPMENT` status is the shipment's "Created/Ready" stage, so the `PENDING`/`READY` values of DB Design §9 are not stored. This keeps cancellation before pickup (TASK-033) free of shipment rows. Order 1─N shipments is kept for later split shipments; today each order ships once (the order transition happens once).

## 2. One transaction for the handoff

`mark-shipped` (`MARK_AS_SHIPPED`) runs `changeOrderStatus(READY_FOR_SHIPMENT → SHIPPED)`, `commitForOrder` (reserved stock leaves the warehouse, ADR-0025 §3), `captureWalletReservation` (the `ORDER_WALLET_USE` debit, R38.7; `orders.wallet_amount_captured` is set), creates the shipment with its `SHIPPED` event, an `ORDER_SHIPPED` audit entry and the `ORDER_SHIPPED` outbox event. Any failure rolls all of it back. It needs an **active** assigned company (`409 CONFLICT`, `SHIPPING_COMPANY_REQUIRED` / `SHIPPING_COMPANY_INACTIVE`); the tracking number is optional ("when available", User Flows §8.3).

## 3. Carrier assignment

`assign-shipping` (`ASSIGN_SHIPPING`) sets `orders.shipping_company_id` to an active company while the order is not yet shipped (before handoff the carrier can still change; afterwards it physically has the parcel). The fee is never recalculated (Q126, R37). Audited `ORDER_SHIPPING_ASSIGNED`.

## 4. Shipment state machine

`SHIPMENT_TRANSITIONS` in `src/server/modules/shipping/shipments.ts` is separate from `ORDER_TRANSITIONS` (R2). TASK-034 implements `SHIPPED → OUT_FOR_DELIVERY → DELIVERED` through the manual MVP endpoint `POST /admin/shipments/{id}/status` (`MANAGE_SHIPMENT`; `DELIVERED` also `MARK_AS_DELIVERED`). `DELIVERED` also moves the order `SHIPPED → DELIVERED` and sets both `delivered_at` columns in the same transaction (DB Design §23 "Delivery confirmation"), with the `ORDER_DELIVERED` outbox event. A refused edge is `409 CONFLICT` with `reason = SHIPMENT_STATE_INVALID` (no new stable error code). TASK-035 and TASK-036 add the failure and return edges; their enum values already exist.

Lock order: the order row first, then the shipment row, everywhere.

## 5. Tracking and events

The tracking number is unique per shipping company (DB Design §22), may be added or corrected later (`TRACKING_UPDATED` event, audited with old and new value). `shipment_events` is append-only (trigger); shipments are never deleted. Customers see status, company name, tracking number and event types/times — never staff notes or locations.

## Consequences

- Migration `20261008034000_shipments`: enums `shipment_status`, `shipment_event_type`, tables `shipments`, `shipment_events`, `orders.delivered_at`, checks and triggers. No new dependency.
- Notifications for shipped/delivered (TASK-045) consume the `ORDER_SHIPPED` / `ORDER_DELIVERED` outbox events.
