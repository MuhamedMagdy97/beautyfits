# ADR-0028 — Goods receiving and supplier invoices

- **Status:** Accepted (TASK-023). §3 decided by the product owner on 2026-10-03. The defaults in §4 await the product owner's confirmation.
- **Date:** 2026-10-03
- **Relates to:** ADR-0027 (purchase orders), ADR-0024 (inventory ledger), ADR-0023 (costs), ADR-0021 (uploads), ADR-0018 (approval requests); Business Spec Q101–Q104, Q114–Q117, R19; User Flows §14; DB Design §11 and "v1.2 TASK-023 Amendments"; API Contract §21 and "TASK-023 Amendments"

## 1. Design

- Tables `goods_receipts` (`GR-000001` numbers), `goods_receipt_items` and `purchase_invoices` (DB Design "v1.2 TASK-023 Amendments"). Module `src/server/modules/purchasing/` (`goods-receipts.ts`, `goods-receipts-service.ts`), routes `/admin/purchases/{id}/receive|invoice|close`.
- **Receiving** (`RECEIVE_PURCHASE`, Q114) records one delivery, line by line: delivered and damaged units, plus a note. For each line, units up to what is still due are received. Damaged ones go to Damaged and good ones to Available, in one `PURCHASE_RECEIPT` inventory movement that carries the line's unit cost. Good units beyond what is due are **extras** (Q116). Everything happens in one transaction with the order row locked.
- **Costs** (Q103): accepted units set `latest_purchase_cost` to the line's unit cost and update `weighted_average_cost` with `nextWeightedAverageCost` over Available + Reserved. The first receipt sets `first_goods_receipt_at`, which locks hand-typed costs (ADR-0023). Damaged units do not change costs. Callers with `VIEW_COST_PRICE` get a `costReview` back (Q102): margin, whether the new cost is higher, and the warnings of `marginWarnings`. Nothing changes a price.
- **Extras** open one `PURCHASE_OVER_DELIVERY` approval request per receipt (entity `GOODS_RECEIPT`). Its handler accepts them into Available (with costs updated as above) or records that they went back. An Owner/Admin's own receipt accepts its extras at once, as with their purchase orders (ADR-0027 §3).
- **Order status**: after each receipt the order becomes `RECEIVED` when every line has its ordered quantity received (accepted + damaged), otherwise `PARTIALLY_RECEIVED`. Receiving is allowed from `APPROVED`, `SENT` and `PARTIALLY_RECEIVED`. A partly received order can no longer be cancelled; it is closed instead.
- **Invoices** (`SUPPLIER_PAYMENT_MANAGE`, API v1.1 "Supplier finance") are recorded as issued: number, date, total, tax and the invoice file. They are never edited to match a receipt (Q115). Files use the upload flow (ADR-0021) with the new purpose `SUPPLIER_INVOICE`, which takes images (JPEG/PNG/WebP). Only staff with `SUPPLIER_FINANCE_VIEW` or `SUPPLIER_PAYMENT_MANAGE` can see invoices and their files.
- **Closing** (`PURCHASE_CREATE`, reason required): from `PARTIALLY_RECEIVED` or `RECEIVED`, once at least one invoice is recorded (Q117) and no extras await approval.
- **Database guards**: receipts, receipt lines and invoices are append-only (trigger `purchasing_reject_change`). Each receipt line satisfies delivered = accepted + damaged + extras. A `CLOSED` order has who, when and why.
- **Receiving staff** (`RECEIVE_PURCHASE` without `PURCHASE_VIEW`) can list and read orders so they can find deliveries. Unit costs and totals are left out for them.
- **Retries**: `/receive` requires `Idempotency-Key` (stored in `idempotency_keys` for 7 days). The same key and body return the receipt already recorded; the same key with another body gets `409 IDEMPOTENCY_CONFLICT`.

## 2. Out of scope

Supplier returns of damaged units, payments, credits and the supplier ledger (TASK-024). Staff notifications for margin warnings (the staff notifications task). PDF invoices. Purging expired idempotency keys (with the checkout idempotency work). Dashboard screens.

## 3. Decisions by the product owner (2026-10-03)

1. **One-step receiving.** The receiver inspects and records the receipt once, and stock changes at once. No separate review step, so the receipt statuses `PENDING_INSPECTION`/`APPROVED`/`REJECTED`/`PARTIALLY_APPROVED` of DB Design §11 are not created.
2. **Damaged units go to Damaged stock** (Q109). The supplier return (TASK-024) moves them out with its own movement.
3. **Approved extras cost the line's unit cost.** Rejected extras are recorded as sent back and never enter stock.
4. **Short orders are closed by hand** with `POST /admin/purchases/{id}/close`: `PURCHASE_CREATE`, reason required, from Partially Received or Received, only once a supplier invoice is recorded.

## 4. Technical defaults (awaiting the product owner's confirmation)

1. Damaged units count against the ordered quantity. Damaged units beyond what is still due are refused: they are noted, not counted as delivered.
2. A line needs a note when it is short, has damaged units or has extras (User Flows §14.1).
3. Invoices carry no lines: the invoice's totals and file are kept as issued, and quantity differences are described on the receipts. Several invoices per order are allowed; an invoice number appears once per order.
4. Invoices are images only in v1 (a photo or scan); PDF needs its own content checks first.
5. Extras are approved or rejected per receipt, all together.
6. The weighted average is computed over Available + Reserved; damaged units carry no weight.
7. `costReview` reports every cost change of the receipt; it is shown only to `VIEW_COST_PRICE` holders.

## Consequences

- Migration `goods_receipts`: three tables, one sequence, checks, append-only triggers, the `PURCHASE_RECEIPT` movement type, the `SUPPLIER_INVOICE` upload purpose and the closing columns on `purchase_orders`.
- TASK-024 links supplier returns to `goods_receipts` and moves damaged units out of Damaged.
- No new dependency.
