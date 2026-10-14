# ADR-0048 — Shipping Cancellation, Return to Sender and Cancellation after Return

- **Status:** Accepted (TASK-036)
- **Date:** 2026-10-14
- **Relates to:** ADR-0039 (order cancellation), ADR-0040 (shipments), ADR-0047 (delivery failures), ADR-0025 (reservations), ADR-0034 (wallet); Business Spec Q10, Q33, Q88, Q89, Q127, Q130, R2, R3, R11, Audit Correction 5; User Flows §8.3, §8.4, §10; API §15, §16 and "TASK-036 Amendments"; DB Design §9 and "v1.2 TASK-036 Amendments"

## 1. The request is recorded on the shipment

After carrier pickup there is no direct cancellation (R3, R11). A shipping cancellation request sets `shipments.cancellation_requested_at`, writes a `SHIPPING_CANCELLATION_REQUESTED` shipment event (the reason, if given, as staff-only notes), the audit entry `SHIPPING_CANCELLATION_REQUESTED` and the outbox event of the same name. The order stays `SHIPPED`. It is made by:

- the customer's `POST /orders/{orderId}/cancel` on a `SHIPPED` order (API §15), and
- `POST /admin/orders/{orderId}/request-shipping-cancellation` (`REQUEST_SHIPPING_CANCELLATION`, Q88; reason optional).

It is accepted while the parcel is still on its way (`SHIPPED`, `OUT_FOR_DELIVERY`, `DELIVERY_FAILED`) and once per shipment. Admin `cancel` of a `SHIPPED` order stays refused (ADR-0039). The column (rather than only the event) keeps the "already requested" check and the read models simple.

## 2. Return edges

`SHIPMENT_TRANSITIONS` gains `→ RETURN_TO_SENDER` from `SHIPPED`, `OUT_FOR_DELIVERY` and `DELIVERY_FAILED`, and `RETURN_TO_SENDER → RETURNED` (`returned_at`), through the manual status endpoint (`MANAGE_SHIPMENT`). Before a failed attempt a parcel is only sent back on a request (`409 CONFLICT`, `SHIPPING_CANCELLATION_REQUIRED`); after a failure it may be returned without one (User Flows §10 "eventual Return to Sender"). A carrier that could not stop the parcel may still deliver it (`OUT_FOR_DELIVERY → DELIVERED`); that is then a customer return, not a cancellation (User Flows §8.4).

## 3. Inspection and cancellation

`POST /admin/shipments/{id}/inspect-return` runs, in one transaction, for a `RETURNED`, not yet inspected shipment of a `SHIPPED` order (Q130):

- the body lists the units damaged in shipping per order line (`damaged: [{ orderItemId, quantity }]`, default none); every other unit is intact;
- one `SHIPMENT_RETURN` inventory movement per variant (reference `SHIPMENT`) puts intact units into Available and damaged ones into Damaged (all stock changes produce movements);
- the shipment gets `inspected_at` and a `RETURN_INSPECTED` event (notes);
- the order moves `SHIPPED → CANCELLED` (`cancelled_at`, history) and `releaseOrderHolds` releases the discount use (stock and wallet holds were already consumed at shipping, so those steps do nothing);
- the wallet credit captured at shipping (`orders.wallet_amount_captured`) is credited back with a new `ORDER_CANCELLATION_REFUND` wallet transaction (Audit Correction 5: a refund only of funds actually captured);
- audit `SHIPMENT_RETURN_INSPECTED` and `ORDER_CANCELLED`, outbox `ORDER_CANCELLED`.

The same step closes both paths (requested cancellation, and return after failed deliveries) because Q130 and User Flows §10 require inspection before cancelling in both. User Flows §8.3 lists `Shipped → Cancelled` "only after a shipping cancellation request"; Business Spec Q130 (higher in the source order) and User Flows §10 also cover the failed-delivery return. Reported in the task file.

**Permission:** the documents say "Authorized ops" (User Flows §8.3) and name no code. `INSPECT_RETURN` ("Inspect returned items", Q94: warehouse/authorized employee inspects) is used provisionally; the owner is asked to confirm (TASK-036 open items).

## Consequences

- Migration `20261014036000_shipping_cancellation`: enum values (`shipment_event_type`: `SHIPPING_CANCELLATION_REQUESTED`, `RETURN_TO_SENDER`, `RETURNED`, `RETURN_INSPECTED`; `inventory_movement_type.SHIPMENT_RETURN`; `wallet_transaction_type.ORDER_CANCELLATION_REFUND`), `shipments.cancellation_requested_at`, `returned_at`, `inspected_at`, checks. No new dependency.
- Carrier damage claims, return shipping costs and fee deductions are not modelled (open items).
