# TASK-036 — Shipping Cancellation & Return-to-Sender

## Goal

After carrier pickup, customers and staff can request a shipping cancellation (the order stays `SHIPPED`); staff bring the parcel back (`RETURN_TO_SENDER → RETURNED`), inspect it for shipping damage and the order is cancelled with its stock and wallet effects.

## Dependencies

TASK-033 (cancellation, ADR-0039), TASK-034 (shipments, ADR-0040), TASK-035 (delivery failures, ADR-0047), TASK-020 (inventory movements), TASK-028 (wallet).

## Source of Truth

- Business Spec Q10, Q33, Q88, Q89, Q127, Q130, R2, R3, R11, Audit Correction 5
- User Flows §8.2, §8.3, §8.4, §10
- DB Design §9, §10, §13
- API Contract §15 (`cancel`, `request-shipping-cancellation`), §16 (shipment `status`)
- Permission catalog (`REQUEST_SHIPPING_CANCELLATION`, `MANAGE_SHIPMENT`, `INSPECT_RETURN`)

## Scope

- Shipping cancellation request (customer `cancel` of a `SHIPPED` order, `request-shipping-cancellation`).
- Shipment edges to `RETURN_TO_SENDER` and `RETURNED`.
- `POST /admin/shipments/{shipmentId}/inspect-return`: shipping-damage inspection, stock back (Available / Damaged), order `SHIPPED → CANCELLED`, discount use released, captured wallet credit refunded.

## Non-Goals

- Customer returns after delivery (TASK-037 → TASK-040); carrier damage claims; return shipping costs or fee deductions; notifications for the request (outbox event only); carrier webhooks; UI.

## Files / Modules

- `src/server/modules/shipping/shipping-cancellation.ts`, `shipments.ts`, `shipments-service.ts`, `schemas.ts`, `shipments.test.ts`
- `src/server/modules/orders/orders-service.ts` (customer cancel of a shipped order), `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/orders/[orderId]/request-shipping-cancellation/route.ts`, `src/app/api/v1/admin/shipments/[shipmentId]/inspect-return/route.ts`, `src/app/api/v1/orders/[orderId]/cancel/route.ts` (doc)
- `prisma/schema.prisma`, `prisma/migrations/20261014036000_shipping_cancellation/`
- Docs: ADR-0048, API / DB "TASK-036 Amendments", TASK-033 amendment row, roadmap

## Business Rules

- R3, R11, Q33, Q88: after pickup no direct cancellation; a request is recorded on the shipment (event + audit) with `REQUEST_SHIPPING_CANCELLATION`; the order stays `SHIPPED`.
- Q89, User Flows §8.4: Shipped → Cancellation Requested → Return to Sender → Returned → inspection → Cancelled.
- Q130, User Flows §10: a returned parcel is inspected for shipping damage before the order is cancelled; separate from Customer Return.
- R11, Audit Correction 5: cancellation gives back what the order holds; captured wallet funds come back as a wallet credit transaction.
- All stock changes produce movements; wallet changes produce ledger transactions.

## API Changes

API Contract "TASK-036 Amendments"; TASK-033 amendment row for `SHIPPED` updated.

## Database Changes

Migration `20261014036000_shipping_cancellation`; DB Design "v1.2 TASK-036 Amendments".

## Security / Authorization

Customer: own orders only (404 otherwise). Staff endpoints need their permission; inspection `INSPECT_RETURN` (confirmed by the owner, 2026-10-15). Order then shipment rows are locked; every step is one transaction. Customers never see staff notes (request reason, inspection notes). Audited; logs carry ids only.

## Acceptance Criteria

- A request on a shipped order is recorded once on its shipment; the order stays `SHIPPED`; admin `cancel` of a shipped order is still refused.
- `RETURN_TO_SENDER` before a failed attempt needs a request; after `DELIVERY_FAILED` it does not; `RETURNED` sets `returnedAt`.
- Inspection of a returned parcel cancels the order once, puts intact units into Available and damaged ones into Damaged with movements, releases the discount use and refunds captured wallet credit; any failure rolls back everything.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/admin/shipments/shipments-routes.int.test.ts` ("shipping cancellation and return to sender"): customer request, duplicate request, permissions, admin cancel still refused, return edges and guard, inspection validation, stock/damaged, wallet refund, outbox, audit, double inspection; failed-delivery return without a request; request before shipping / after delivery.
- `src/app/api/v1/orders/cancel-routes.int.test.ts`: a shipped order without a parcel is refused.
- Unit `src/server/modules/shipping/shipments.test.ts`: return edges and the request guard.

## Edge Cases

- The carrier could not stop the parcel and delivered it: `DELIVERED` is still allowed; the customer then uses a Customer Return.
- A guest order has no wallet credit; nothing is refunded.
- One variant on two lines: one movement per variant with the summed quantities.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- Resolved (owner decision 2026-10-15): the inspection that cancels a shipped order uses `INSPECT_RETURN`.
- Resolved (owner decision 2026-10-15): a change-of-mind cancellation after pickup (a shipping cancellation was requested) keeps the order's shipping fee and refunds the rest of the captured wallet credit, as Q15 does for returns; a parcel returned after failed delivery is refunded in full.
- Resolved (owner decision 2026-10-18): keep current behaviour — damaged units go to Damaged stock; no carrier damage claim or charge is recorded (BD-028).
- Resolved (owner decision 2026-10-18): not in v1; keep as is — lost or missing units in a returned parcel are not modelled; every unit is recorded intact or damaged (BD-029).
- Documentation conflict (reported, not resolved silently): User Flows §8.3 allows `Shipped → Cancelled` "only after a shipping cancellation request", while Business Spec Q130 and User Flows §10 cancel the order after a failed-delivery return too. Implemented per Q130 (higher source): inspection cancels in both paths.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
