# TASK-054 — Orders, Customers & Returns Dashboard

## Goal
Staff work the order queue, move orders through their statuses, cancel them, look up customers, and review, collect, receive and inspect returns from the dashboard at `/staff`, in Arabic and English.

## Dependencies
TASK-030 → TASK-039 (orders, COD confirmation, cancellation, shipping, returns API), TASK-052 (dashboard shell), TASK-053/055 (screen pieces, carrier cards). TASK-040/041 (refunds, completion) are not built yet and are out of scope here.

## Source of Truth
- Business Spec Q80–Q86, Q90–Q99, R2, R4, R11, R14, R21, R34
- User Flows §8.3, §11.2–§11.4
- API Contract §15, §17, §18 and "TASK-002A", "TASK-030..039 Amendments"; "TASK-054 Amendments" (this task)
- `docs/security/permission-catalog.md`
- Design reference: no dashboard screen exists in `design-reference/google-stitch/`; screens follow the Editorial Velvet tokens of the shell (ADR-0045).
- ADR-0036, ADR-0053, ADR-0058; ADR-0063 (this task)

## Scope
- `/staff/orders`: queue newest first; filters status, order number, phone (with `VIEW_CUSTOMER_CONTACT`), `?customerId=`.
- `/staff/orders/[orderId]`: customer (contact when allowed, link to the customer), address, payment, carrier and link to `/staff/shipping/orders/[orderId]`; items (cost with `VIEW_COST_PRICE`); amounts; COD confirmation; customer changes; status history. Actions by status and permission: record phone confirmation, confirm, start preparing, mark ready for shipment, cancel (reason required), assign carrier / hand over with tracking (before handoff), request shipping cancellation (shipped, parcel still with the carrier).
- `/staff/returns`: queue by status (default pending approval), `?orderId=` / `?customerId=`.
- `/staff/returns/[returnId]`: claim, customer's words, customer photos, lines (ordered / returned) with their inspection, pickup, dates, status history. Actions: approve (note) / reject (reason), request pickup (carrier, tracking, fee payer, notes), receive, start inspection (notes), per-line inspection (split outcomes: result, condition, quantity, notes; staff photos uploaded with purpose `RETURN_INSPECTION`).
- `/staff/customers`: search by name and (with contact access) phone; `/staff/customers/[id]`: account, language, contact and verification, addresses, latest orders (+ all orders, returns), wallet balance and transactions (`VIEW_WALLET_BALANCE`), link to wallet adjustment (`ADJUST_WALLET`).
- API: `GET /admin/customers`, `GET /admin/customers/{customerId}` as listed in the contract.

## Non-Goals
- Return completion and refunds (TASK-040/041): not shown, not offered.
- Wallet adjustment (wallet dashboard task): linked only.
- Order modification by staff (the contract has none), shipment status updates (stay on the shipping screen, TASK-055).

## Files / Modules
- `src/app/staff/(shell)/orders/{page.tsx,[orderId]/page.tsx}`
- `src/app/staff/(shell)/returns/{page.tsx,[returnId]/page.tsx,[returnId]/inspection.tsx}`
- `src/app/staff/(shell)/customers/{page.tsx,[id]/page.tsx}`
- `src/app/staff/(shell)/shipping/orders/[orderId]/handoff.tsx` (carrier cards moved out of the TASK-055 page so both screens use them)
- `src/app/staff/_lib/{orders.ts,orders-i18n.ts,orders.test.ts}`
- `src/app/staff/_components/catalog-ui.tsx` (`useAction` error formatter, `StatusBadge` label)
- `src/server/modules/customers/{admin-customers-service.ts,schemas.ts}`; `addresses-service.ts` (exports its address view)
- `src/app/api/v1/admin/customers/{route.ts,[id]/route.ts,customers-routes.int.test.ts}`
- `docs/decisions/ADR-0063-orders-customers-returns-dashboard.md`, `docs/api/api-contract.md`

## Business Rules
None new. All rules are enforced by the API; the screens show its results and localized refusals.

## API Changes
"TASK-054 Amendments": `GET /admin/customers` and `GET /admin/customers/{customerId}` (`CUSTOMER_VIEW`; phone, email, addresses and the `phone` filter with `VIEW_CUSTOMER_CONTACT`; date of birth never returned).

## Database Changes
None.

## Security / Authorization
- Screens and actions are hidden without their permission (cosmetic); the API authorizes every call.
- Customer contact data (phone, email, addresses) only with `VIEW_CUSTOMER_CONTACT`, on orders and customers alike (Q80); the phone filters are refused without it.
- Inspection photos use the API's single-use upload authorization (purpose `RETURN_INSPECTION`, needs `INSPECT_RETURN`); files are checked by the API.
- No business code is imported into the client at runtime (type-only imports).

## Acceptance Criteria
- Staff with `ORDERS_VIEW` see the queue and order details; each status step and cancel appear only with their permission and status; refusals are shown localized.
- Staff with `RETURNS_VIEW` see returns; approve/reject, pickup, receive, start inspection and inspection appear with their permission and status.
- Staff with `CUSTOMER_VIEW` see customers and their latest orders; contact data only with `VIEW_CUSTOMER_CONTACT`; wallet with `VIEW_WALLET_BALANCE`.
- Money is shown in pounds from integer piastres.
- Arabic renders right-to-left, English left-to-right.
- All required checks pass.

## Tests
- Integration `src/app/api/v1/admin/customers/customers-routes.int.test.ts`: list order and name search, contact fields and phone filter by permission, detail with latest orders, addresses only with contact access, no date of birth, 404 / 403.
- Unit `src/app/staff/_lib/orders.test.ts`: status steps per order/return status, inspection quantity check and body, place snapshots, Arabic/English key parity (nested maps too), refusal localization, account labels.
- The order and return actions are covered by the existing orders, COD, cancellation, shipment, return-request, return-approval and return-inspection route integration tests.

## Edge Cases
- Guest orders: no customer link; "Guest" shown.
- Anonymized customers (R34): shown as "Deleted by the customer".
- Pickup form needs `SHIPPING_VIEW` to list carriers; without it the screen says so.
- Inspection photos are uploaded when the form is sent; a refused inspection leaves those uploads unattached and a retry uploads again.
- Exact multiple of the page size: one empty last page (ADR-0053 §6).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- **Refunds and completion (TASK-040/041)** are not built; the return screen ends at inspection. The inspected return stays `INSPECTING` until those tasks add `complete`.
- **Wallet adjustment link** goes to `/staff/wallet?customerId=…`; the wallet dashboard task should accept that parameter (or the link changes when that screen lands).
- `MANAGE_RETURNS` holders without `SHIPPING_VIEW` cannot pick a carrier for a pickup (the carrier list needs `SHIPPING_VIEW`). Default roles: only Owner/Admin hold `MANAGE_RETURNS`, so no current role is affected.
- No Stitch design exists for these screens; layout is a UX proposal following Editorial Velvet.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
