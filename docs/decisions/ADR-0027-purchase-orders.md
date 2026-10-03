# ADR-0027 — Purchase orders and approval

- **Status:** Accepted (TASK-022); §3 decided by the product owner on 2026-10-03; the defaults in §4 confirmed by the product owner on 2026-10-03
- **Date:** 2026-10-03
- **Relates to:** ADR-0018 (approval requests), ADR-0026 (suppliers), ADR-0011 (money); Business Spec Q101, Q102, Q112, Q113, R19; User Flows §14; DB Design §11 and "v1.2 TASK-022 Amendments"; API Contract §21 and "TASK-022 Amendments"; permission catalog (`PURCHASE_VIEW`, `PURCHASE_CREATE`, `PURCHASE_APPROVE`)

## 1. Design

- Tables `purchase_orders` and `purchase_items` (DB Design "v1.2 TASK-022 Amendments"), module `src/server/modules/purchasing/`, routes `src/app/api/v1/admin/purchases/**`.
- Lifecycle `DRAFT → PENDING_APPROVAL → APPROVED → SENT`; `CANCELLED` from any of these. The receiving statuses belong to TASK-023.
- Submitting opens a `PURCHASE_ORDER` approval request (ADR-0018) in the same transaction. Its handler (`purchase-orders.ts`, registered in `approvals/handlers.ts`) applies the approval or rejection, so `/admin/purchases/{id}/approve|reject` and `/admin/approval-requests/{id}/approve|reject` give the same result.
- Each status change locks the order row and writes an audit entry in its transaction. Creating an order, changing its supplier and submitting lock the supplier row `FOR SHARE` and refuse inactive suppliers (ADR-0026).
- Nothing here changes stock (Q101). Lines keep their own unit cost (Q102); the server computes line totals and the order total in piastres.
- Database guards: orders are never deleted; lines change only while the order is `DRAFT`.

## 2. Out of scope

Goods receipts, invoices and over-delivery approvals (TASK-023); supplier returns, payments and the ledger (TASK-024); the margin warning of Q102 (raised when receiving changes costs, TASK-023); sending the order to the supplier by email or WhatsApp; dashboard screens.

## 3. Decisions by the product owner (2026-10-03)

1. **Owner/Admin orders are approved on submit.** An order submitted by someone holding `PURCHASE_APPROVE` (only Owner/Admin) goes straight to `APPROVED`, recorded as a submit and an approval by that person; no approval request is opened. A Purchasing Manager's order waits for an Owner/Admin, so a single Owner is never blocked.
2. **Rejected orders go back to `DRAFT`.** The creator sees the reason (`approval.resolutionReason`), edits and resubmits.
3. **"Send" only records the status.** Staff send the order themselves; the system sends nothing.
4. **Draft and published products can be ordered** (new products can be stocked before launch); archived products or variants cannot. Disabled products are not archived and can be ordered.

## 4. Technical defaults (confirmed by the product owner, 2026-10-03)

1. Only drafts are edited; changing an approved or sent order means cancelling it and creating a new one.
2. Cancelling needs a reason. Before approval it needs `PURCHASE_CREATE`; once `APPROVED` or `SENT`, `PURCHASE_APPROVE` (API §21).
3. Unit costs are positive; quantities 1–100000; at most 200 lines, each variant once.
4. No tax on the order; tax is recorded on the supplier invoice (TASK-023).
5. Numbers are `PO-000001`, `PO-000002`, … from a database sequence.
6. Unit costs on an order are visible with `PURCHASE_VIEW` (they are the order's own figures); the variants' average costs stay behind `VIEW_COST_PRICE`.

## Consequences

- Migration `purchase_orders` (two tables, one enum, one sequence, checks, two triggers).
- TASK-023 receives against `purchase_items` and sets the receiving statuses and the first-receipt costs.
- No new dependency.
