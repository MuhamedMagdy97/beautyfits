# ADR-0063 — Orders, customers & returns dashboard screens

**Status:** Accepted (TASK-054, 2026-10-15)

## Context
TASK-054 replaces the `/staff/orders`, `/staff/customers` and `/staff/returns` placeholders. The order and return API exists (TASK-030..039). The API contract ("TASK-002A Amendments") lists `GET /admin/customers` and `GET /admin/customers/{customerId}` (`CUSTOMER_VIEW`, contact data with `VIEW_CUSTOMER_CONTACT`, Q80), but no task had implemented them. Refunds and return completion (TASK-040/041) do not exist yet. Other dashboard screens are being built in parallel, so shared files should change as little as possible.

## Decision
1. **Same pattern as ADR-0053/ADR-0058.** Client of `/api/v1/**` only, response types imported type-only, `_components/catalog-ui.tsx` pieces, money shown in pounds (`_lib/money.ts`). Texts live in a new `_lib/orders-i18n.ts` (Arabic and English) instead of growing the shared dictionaries; it also maps the refusals these screens meet (`ORDER_STATE_INVALID`, `RETURN_STATE_INVALID`, `ORDER_CANCELLATION_NOT_ALLOWED`, `RETURN_ITEM_ALREADY_INSPECTED`). Return status labels are passed to `StatusBadge` (new optional `label`), and `useAction` takes an optional error formatter — the only shared-component changes.
2. **Routes.** `/staff/orders` (status, order number, and with `VIEW_CUSTOMER_CONTACT` phone; `?customerId=` from the customer page), `/staff/orders/[orderId]` (details, items, amounts, COD confirmation, customer changes, status history, the step of the status, cancel with reason, carrier assignment / handoff / shipping-cancellation request, link to the shipping screen), `/staff/returns` (+ `?orderId=` / `?customerId=`), `/staff/returns/[returnId]` (claim, customer photos, lines with inspections, status history; approve / reject, carrier pickup, receive, start inspection, per-line inspection with staff photos), `/staff/customers` and `/staff/customers/[id]` (profile, contact, addresses, latest orders, wallet balance and transactions).
3. **Contract mirrors.** The button offered per order and return status follows the contract tables (`_lib/orders.ts`); the API still decides and its refusal is shown. The carrier cards of TASK-055 are moved to `shipping/orders/[orderId]/handoff.tsx` and used by both screens.
4. **Admin customer endpoints implemented as the contract lists them** (`src/server/modules/customers/admin-customers-service.ts`): newest first, `search` matches the name, the `phone` filter needs `VIEW_CUSTOMER_CONTACT` (`403` otherwise), as on `GET /admin/orders` (ADR-0036). Without contact access no phone, email or address is returned; the date of birth is never returned. The detail carries the 20 latest orders and `orderCount`; the full history is the order list filtered by `customerId`.
5. **Inspection photos** are uploaded one by one (`RETURN_INSPECTION`, init → bytes → complete) when the inspection is submitted, then attached by id. The sum of a line's outcome quantities is checked in the form before upload; every other rule stays with the API.
6. **Nothing invented for refunds.** Completion and the wallet refund (TASK-040/041) are not offered; the return screen shows only what the API returns.

## Consequences
- Two new read endpoints; no database or permission changes.
- A failed inspection submit after the photos were uploaded leaves unattached uploads; a retry uploads them again (unattached uploads are inert).
- The customer page links to `/staff/wallet?customerId=…` for adjustments; that screen belongs to the wallet dashboard task.
