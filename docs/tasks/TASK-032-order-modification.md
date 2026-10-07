# TASK-032 — Order Modification & Re-confirmation

## Goal

A signed-in customer can change an own order before Preparing (items, address, wallet credit). The backend prices the change, the customer confirms it, and only then does the order change, with the earlier state preserved.

## Dependencies

TASK-030 (state machine, immutable snapshots), TASK-031 (COD confirmation), TASK-029 (checkout pricing), TASK-020/026/027/028 (reservations, discounts, shipping, wallet).

## Source of Truth

- Business Spec C4, C5, Q32, R16, R36, R37, R39, R40
- User Flows §9
- DB Design `order_revisions`, "v1.2 TASK-032 Amendments"
- API Contract §15, "TASK-032 Amendments"

## Scope

- `POST /orders/{orderId}/modify` (revision preview) and `POST /orders/{orderId}/revisions/{revisionId}/confirm`.
- Pricing per R40: ordered quantity keeps its price, extra at today's price; order-time discount terms; shipping re-quoted; wallet re-held.
- Applying a confirmed revision: stock, wallet and discount use moved; lines and amounts replaced; previous state kept; `CONFIRMED → NEW`.
- `pendingRevision` on the customer order, `revisions` on the admin order.
- Migration `order_revisions` with the guarded trigger amendment.

## Non-Goals

- Staff editing on the customer's behalf, guest editing, adding or switching discounts, secure-token revision confirmation (R40); cancellation (TASK-033); notifications (TASK-045); UI.

## Files / Modules

- `src/server/modules/orders/revisions.ts` (pure), `revisions-service.ts`, `orders.ts` (edge), `orders-service.ts` (views), `schemas.ts`
- `src/server/modules/checkout/checkout-service.ts` (`resolveAddress` exported), `src/server/modules/audit/audit.ts`
- `src/app/api/v1/orders/[orderId]/modify/`, `src/app/api/v1/orders/[orderId]/revisions/[revisionId]/confirm/`
- `prisma/migrations/*_order_revisions/`, `prisma/schema.prisma`
- Docs: ADR-0038, Business Spec R40, DB Design / API Contract "TASK-032 Amendments"

## Business Rules

- C5, Q32: changes before Preparing; material changes are recalculated and re-confirmed; history is not silently rewritten.
- R40: who, what, prices, discount, shipping, 24-hour confirmation window, back to New.
- C4: a wallet covering the whole total needs no COD confirmation.

## API Changes

API Contract "TASK-032 Amendments".

## Database Changes

Migration `order_revisions`. DB Design "v1.2 TASK-032 Amendments".

## Security / Authorization

Only the order's signed-in customer (404 otherwise). All amounts are computed server-side and re-computed at confirmation; the client only sends variant ids, quantities, address and wallet amount. Order changes happen in one locked transaction and only through the revision path (trigger flag). Audited; logs carry ids only.

## Acceptance Criteria

- Modify returns a priced revision and leaves the order unchanged; confirm applies it atomically.
- Ordered quantity keeps its price; extra quantity and new items use today's price.
- Discount kept with order-time terms or dropped with its use released; shipping re-quoted for a new address.
- Stock and wallet holds follow the new amounts; a wallet covering the total moves a pending order to New.
- A Confirmed order goes back to New; Preparing or later is refused.
- Superseded, lapsed or changed revisions cannot be confirmed; the order stays as it was.
- All required checks pass.

## Tests

- Unit `src/server/modules/orders/revisions.test.ts`: line planning, effective status, canonical JSON; `orders.test.ts`: the new edge.
- Integration `src/app/api/v1/orders/revisions-routes.int.test.ts`: pricing, confirm, back to New, address, discount kept/dropped, wallet, ownership/status/no-change refusals, stock, superseded/expired, re-pricing difference, triggers still enforced.

## Edge Cases

- Two prices for one variant after a revision; a later reduction keeps the cheaper line first.
- Price, shipping rule or wallet changed between preview and confirm: `RECONFIRMATION_REQUIRED`.
- Staff start preparing while a revision is open: the revision can no longer be confirmed.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- None. Owner decisions of 2026-10-07 are recorded as Business Spec R40.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
