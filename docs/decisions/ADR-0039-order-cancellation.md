# ADR-0039 — Order Cancellation

- **Status:** Accepted (TASK-033)
- **Date:** 2026-10-08
- **Relates to:** ADR-0036 (state machine), ADR-0037 (COD expiry), ADR-0038 (revisions), ADR-0025 (reservations), ADR-0032 (discount uses), ADR-0034 (wallet holds); Business Spec Q10, Q28, Q33, Q86–Q89, R3, R11, R16, R36; User Flows §8.3–8.4; API §15 and "TASK-033 Amendments"; DB Design "v1.2 TASK-033 Amendments"

## 1. One cancel step for customers and staff

`POST /orders/{orderId}/cancel` (signed-in owner; another customer's order is `404`) and `POST /admin/orders/{orderId}/cancel` (`CANCEL_ORDER`) share one function in `orders-service.ts`. In one transaction it locks the order, accepts only the R11 window (`CANCELLABLE_ORDER_STATUSES`: Pending Confirmation, New, Confirmed, Preparing, Ready for Shipment), moves it to `CANCELLED` with `changeOrderStatus` (`cancelled_at`; the history row carries the actor and the reason), releases what it holds, and writes the `ORDER_CANCELLED` audit entry and outbox event. Outside the window the answer is `422 ORDER_CANCELLATION_NOT_ALLOWED` with `details.status`. The reason is required for staff (Q86) and optional for the customer (no rule asks for one). A repeated cancel is refused rather than replayed: the order lock and the status check make it impossible to release twice.

## 2. Cancellation and expiry release through one helper

`releaseOrderHolds` in `orders.ts` calls the existing idempotent `releaseForOrder`, `releaseDiscountUsage` and `releaseWalletReservation`; the COD expiry job (ADR-0037 §4) now uses it too, so both endings give back exactly the same things (Q28, R36, Audit Correction 5). Expiry itself is unchanged: only the System expires, only from Pending Confirmation, at the deadline. The expiry job re-checks the status under the lock, so a cancelled order is skipped, and a cancelled or expired order cannot be confirmed, revised or cancelled again (terminal states in `ORDER_TRANSITIONS`).

## 3. Who cancelled is not duplicated on the order

Only `orders.cancelled_at` is added. The actor and the reason are already recorded in `order_status_history` and `audit_logs`; copying them onto the order would be a second source of truth.

## 4. Shipping cancellation waits for shipments

After carrier pickup R3 requires the request to be recorded on the Shipment (a `shipment_events` row) while the order stays `SHIPPED`. Shipments do not exist before TASK-034, so TASK-033 refuses a `SHIPPED` order with `details.reason = AFTER_CARRIER_PICKUP` on both endpoints. TASK-036 (which depends on TASK-033 and TASK-034) turns the customer `cancel` of a `SHIPPED` order into that request, adds `request-shipping-cancellation` (`REQUEST_SHIPPING_CANCELLATION`) and performs `SHIPPED → CANCELLED` after the returned shipment is inspected. By then stock was committed and the wallet captured at shipping, so that path does not use `releaseOrderHolds`.

## Consequences

- Notifications for `ORDER_CANCELLED` are sent by the notification service (TASK-045) from the outbox.
- Guests still have no online cancellation (R16); staff cancel for them.
