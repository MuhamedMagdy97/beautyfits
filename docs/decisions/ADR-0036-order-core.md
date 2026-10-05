# ADR-0036 — Order Core: Reads, State Machine and Immutable Snapshots

- **Status:** Accepted (TASK-030)
- **Date:** 2026-10-05
- **Relates to:** ADR-0035 (checkout creates orders), ADR-0025 (reservations), ADR-0018 (audit); Business Spec Q46, Q80–Q84, Q184, Q185, R1–R4, R11, R16, R19, R34; User Flows §8; API §15 and "TASK-030 Amendments"; DB Design §8, §24 and "v1.2 TASK-030 Amendments"

## 1. One state machine, one helper

`ORDER_TRANSITIONS` in `src/server/modules/orders/orders.ts` is the whole graph of User Flows §8 (R1–R4, R11): one step forward at a time, `EXPIRED` only from `PENDING_CONFIRMATION`, `CANCELLED` from every status up to `SHIPPED` (after `SHIPPED` only once the shipment came back, R3), nothing out of `DELIVERED`, `CANCELLED`, `EXPIRED`. Every status change goes through `changeOrderStatus` (lock the order row, check the edge, update, write `order_status_history`), so later tasks (COD confirmation, cancellation, expiry, shipping) cannot jump states. A refused edge is `409 ORDER_STATE_INVALID` with the current and requested status.

## 2. Staff transitions here

`confirm` (`CONFIRM_ORDER`, sets `confirmed_at`, writes the `ORDER_CONFIRMED` outbox event), `start-preparing` (`START_PREPARING`) and `mark-ready-for-shipment` (`MARK_READY_FOR_SHIPMENT`). Each also writes an audit entry (`ORDER_CONFIRMED`, `ORDER_PREPARING_STARTED`, `ORDER_READY_FOR_SHIPMENT`). No approval in v1 (R19). `mark-shipped` and delivery belong to the shipment task (TASK-034), because shipping commits stock (ADR-0025) and captures wallet credit (R38.7); COD confirmation (`PENDING_CONFIRMATION → NEW`) to TASK-031; cancellation and expiry to TASK-033.

## 3. Reading orders

Orders are always read from their snapshots (Q46, Q184). Customers see their own orders (`GET /me/orders`, `GET /orders/{orderId}`; another customer's order is 404); guests have no online access (R16). Staff need `ORDERS_VIEW`. Contact data — phone, email and the street address — needs `VIEW_CUSTOMER_CONTACT` (without it only the name, governorate and area are shown, and the `phone` filter is `403`); `unit_cost_at_sale` needs `VIEW_COST_PRICE` (Q74, Q80). Warehouse roles therefore see what to pack, not who to call.

## 4. Snapshots are enforced by the database

Trigger `orders_immutable` rejects deleting an order and changing its commercial snapshot: number, contact, guest fields, money, tax, discount, shipping rule, address, customer snapshot, locale, creation time. Lifecycle columns (status, timestamps, captured wallet amount, proposed shipping company — staff may change the carrier, Q126) stay writable, and `customer_id` may go from null to an account once (guest order claim, Q43). Trigger `order_items_immutable` rejects any update or delete of an order item. TASK-032 (order modification) records revisions in `order_revisions` and must amend these triggers explicitly if a confirmed revision changes the order's amounts.

## 5. Foreign keys

`inventory_reservations.order_id`, `discount_usages.order_id` and `wallet_reservations.order_id` now reference `orders` (`RESTRICT`). Engine tests create a minimal order with `bareOrder` (`src/test/integration/orders.ts`).

## Consequences

- Migration `order_core`: `orders.confirmed_at`, the three foreign keys, both triggers. No new dependency.
- `/me/deactivate` (R34) now also refuses while the customer has an order that is not `DELIVERED`, `CANCELLED` or `EXPIRED` (`openItems: ["OPEN_ORDER"]`).
- The checkout response builder moved to the orders module (`loadOrderSummary`); its shape is unchanged.
