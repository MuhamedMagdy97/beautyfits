# ADR-0058 — Purchasing & shipping dashboard screens

**Status:** Accepted (TASK-055, 2026-10-15)

## Context
TASK-055 adds dashboard screens for suppliers, purchase orders, goods receiving, supplier invoices, supplier returns, supplier payments and ledger, carriers, shipments, delivery events, contact tasks and shipping cancellation. The API exists (TASK-021..036). Some reads the screens would naturally use do not exist: there is no shipment list, no single-supplier read, and the goods receipt lines in `purchase.receipts` carry no id. There is no Stitch reference for dashboard screens.

## Decision
1. **Same pattern as ADR-0053.** Client of `/api/v1/**` only, response types imported type-only, `_components/catalog-ui.tsx` pieces, money typed in pounds and sent as integer piastres (`_lib/money.ts`). Screen texts live in `_lib/purchasing-i18n.ts` (Arabic and English). Status labels and `CONFLICT` reasons are added to the shared maps in `_lib/catalog-i18n.ts` so `StatusBadge` and `useAction` show them; a `Tabs` component is extracted from `CatalogTabs`.
2. **Routes.** `/staff/suppliers` (+ `/[id]` balance, ledger, payment), `/staff/purchases` (+ `/[id]` lines, actions, receiving, receipts, invoices, returns), `/staff/purchases/returns` (+ `/[id]` submit, settle), `/staff/shipping` (shipments queue), `/staff/shipping/carriers`, `/staff/shipping/contact-tasks`, `/staff/shipping/orders/[orderId]`.
3. **Shipments queue = order list.** Without a shipment list endpoint, `/staff/shipping` lists orders by status (`GET /admin/orders`, default `READY_FOR_SHIPMENT`) and each order opens its shipping screen, which reads `GET /admin/orders/{id}` (`shipments` with events). Order state changes other than the carrier handoff stay with the orders screen (TASK-054).
4. **Contract mirrors.** Buttons offered per purchase-order status and next shipment statuses follow the API contract tables (as ADR-0053 §2 does for product lifecycle); the API still decides and its refusal is shown.
5. **Navigation.** The `purchases` section also shows with `RECEIVE_PURCHASE` (its read endpoints accept it) and `SUPPLIER_RETURN_MANAGE` (supplier returns are a tab there); `shipping` also shows with `MARK_AS_SHIPPED`, `MANAGE_SHIPMENT`, `INSPECT_RETURN` and `CONTACT_TASK_MANAGE`, whose holders work on shipments. Cosmetic only. This is the one shell file the task changes.
6. **Purchase lines are typed as text** (`SKU, quantity, unit cost in EGP`, one per line) and each SKU is looked up with the inventory search (`INVENTORY_VIEW`, held by the Purchasing Manager role). Editing a draft replaces all lines (API behavior).
7. **Retries.** Receiving and supplier payments send an `Idempotency-Key` generated per form (`crypto.randomUUID()`), renewed after success, so a repeated submit records one receipt or payment.
8. **Gaps are not filled by invention.** Creating a supplier return, the single-supplier read and a shipment list are listed as open items in the task file instead of new endpoints.

## Consequences
- No API, database or permission changes.
- Supplier returns can be viewed, submitted and settled, but not created, from the dashboard until the API exposes goods receipt line ids.
- The supplier finance page shows the supplier name from the link (display only).
