# TASK-055 — Purchasing & Shipping Dashboard

## Goal
Staff manage suppliers, purchase orders (with approval), goods receiving, supplier invoices, supplier returns, supplier payments and ledger, carriers, shipments, delivery events, contact tasks and shipping cancellation from the dashboard at `/staff`, in Arabic and English.

## Dependencies
TASK-021 → TASK-036 (purchasing and shipping API), TASK-052 (dashboard shell), TASK-053 (screen pieces).

## Source of Truth
- Business Spec Q101–Q107, Q112–Q120, Q126–Q130, R2, R3, R14
- User Flows §8.2, §8.3, §10, §14
- API Contract §16, §21 and "TASK-021..024", "TASK-034..036 Amendments"
- `docs/security/permission-catalog.md`
- Design reference: no dashboard screen exists in `design-reference/google-stitch/`; screens follow the Editorial Velvet tokens of the shell (ADR-0045).
- ADR-0045, ADR-0053; ADR-0058 (this task)

## Scope
- `/staff/suppliers`: list (search, status), create, edit, deactivate / reactivate.
- `/staff/suppliers/[id]`: balance with Q118 status per order, ledger, record payment (`Idempotency-Key`).
- `/staff/purchases`: list (search, status), new draft (lines typed as `SKU, quantity, unit cost`).
- `/staff/purchases/[id]`: lines with received/accepted/damaged/extra/remaining; submit, approve, reject, mark sent, cancel, close; edit a draft; receive goods (`Idempotency-Key`, cost review notice); goods receipts with the over-delivery approval state; supplier invoices (list, record with image upload); the order's supplier returns.
- `/staff/purchases/returns` and `/[id]`: list, details, submit for approval, settle.
- `/staff/shipping`: shipments queue (orders by status); `/staff/shipping/orders/[orderId]`: assign carrier, hand over (tracking), tracking update, status updates (out for delivery, delivered, failed, return to sender, returned) with location/notes, events, shipping cancellation request, returned-parcel inspection.
- `/staff/shipping/carriers`: list, create, edit, deactivate / reactivate.
- `/staff/shipping/contact-tasks`: list by status, assign to me / unassign, start, resolve, cancel, outcome notes.
- Navigation: `purchases` and `shipping` sections also shown to the staff who act there (ADR-0058 §5).

## Non-Goals
- API, database or permission changes.
- Shipping rules (TASK-027 rules screen) and order state changes other than the carrier handoff (TASK-054).
- Over-delivery and supplier-return approvals: resolved in the existing `/staff/approvals` queue (TASK-057), linked from here.

## Files / Modules
- `src/app/staff/(shell)/suppliers/{page.tsx,[id]/page.tsx}`
- `src/app/staff/(shell)/purchases/{page.tsx,tabs.tsx,lines.ts}`, `[id]/{page,receiving,invoices,returns}.tsx`, `returns/{page.tsx,table.tsx,[id]/page.tsx}`
- `src/app/staff/(shell)/shipping/{page.tsx,tabs.tsx}`, `carriers/page.tsx`, `contact-tasks/page.tsx`, `orders/[orderId]/{page,shipment}.tsx`
- `src/app/staff/_lib/{purchasing.ts,purchasing-i18n.ts,purchasing.test.ts}`; `catalog-i18n.ts` (statuses, conflict reasons); `navigation.ts`
- `src/app/staff/_components/catalog-ui.tsx` (`Tabs`)
- `docs/decisions/ADR-0058-purchasing-shipping-dashboard.md`
- `src/server/modules/approvals/handlers.ts`: build fix only. `settings-service → approvals → handlers → settings-service` is an import cycle; with the new routes the production build evaluated `handlers.ts` before `settings-service.ts` finished (`Cannot access … before initialization` while collecting `/api/v1/admin/settings`). The handler map now reads each handler on use (getters); behavior is unchanged.

## Business Rules
None new. All rules are enforced by the API; the screens show its results and localized refusal reasons.

## API Changes
None.

## Database Changes
None.

## Security / Authorization
- Screens and actions are hidden without their permission (cosmetic); the API authorizes every call.
- Amounts appear only when the API returns them (`PURCHASE_VIEW`); invoices only for supplier finance.
- Invoice images use the API's single-use upload authorization (purpose `SUPPLIER_INVOICE`); files are checked by the API.
- Receiving and payments send an `Idempotency-Key` per form, so a retried submit records once.
- No business code is imported at runtime (type-only imports).

## Acceptance Criteria
- Staff with `SUPPLIER_VIEW` see suppliers; `SUPPLIER_MANAGE` creates/edits/deactivates; `SUPPLIER_FINANCE_VIEW` sees balance and ledger; `SUPPLIER_PAYMENT_MANAGE` records payments, invoices and settlements.
- Purchase-order actions appear per status and permission; the API's refusals are shown localized.
- Receiving staff (`RECEIVE_PURCHASE`) see the purchases section and receive deliveries.
- Shipping staff assign carriers, hand over, update tracking and delivery status, request shipping cancellation, inspect returned parcels and work contact tasks.
- Money is shown and entered in pounds and sent as integer piastres.
- Arabic renders right-to-left, English left-to-right.
- All required checks pass.

## Tests
- Unit `src/app/staff/_lib/purchasing.test.ts`: purchase-line parsing to piastres and back, refused lines, counts, snapshot names, placeholders, Arabic/English key parity, purchasing/shipping conflict localization, navigation for receiving and shipping staff.
- The flows themselves are covered by the existing suppliers, purchases, receiving, supplier-finance, shipment, delivery-failure and shipping-cancellation route integration tests.

## Edge Cases
- Receiving staff without `PURCHASE_VIEW`: no amounts, no draft editing.
- A receipt that completes the order hides the receive form; its cost review stays visible.
- Rejected purchase order back in Draft: the rejection reason is shown.
- Exact multiple of the page size: one empty last page (ADR-0053 §6).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- **Missing API: creating a supplier return.** `POST /admin/purchases/{id}/supplier-return` needs `goodsReceiptItemId`, but `purchase.receipts[].items[]` (API "TASK-023 Amendments") has no id, and no other read returns it. The dashboard lists, submits and settles returns but cannot create one until a receipt line id is exposed (contract + `purchase-orders-service.ts` change, a backend task).
- **Missing API: single-supplier read.** There is no `GET /admin/suppliers/{id}`; the finance page shows the supplier name passed in the link.
- **Missing API: shipment list.** There is no `GET /admin/shipments`; the shipments queue is the order list by status (ADR-0058 §3).
- Staff with `SUPPLIER_FINANCE_VIEW` but not `SUPPLIER_VIEW` see the Suppliers section (TASK-052 navigation) but `GET /admin/suppliers` refuses them, so they cannot reach a ledger from the list. Product owner: should finance roles get `SUPPLIER_VIEW`, or does the API need a finance-readable supplier list?
- Supplier payments can be linked only to orders that already appear in the balance (invoiced orders); the API also accepts approved/sent orders without an invoice.
- Purchase order lines are typed as text and need `INVENTORY_VIEW` for the SKU lookup; a variant picker can replace this later.
- No Stitch design exists for these screens; layout is a UX proposal following Editorial Velvet.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
