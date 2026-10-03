# ADR-0029 — Supplier returns, payments and ledger

- **Status:** Accepted (TASK-024). §3 decided by the product owner on 2026-10-03. The defaults in §4 await the product owner's confirmation.
- **Date:** 2026-10-03
- **Relates to:** ADR-0028 (goods receiving), ADR-0027 (purchase orders), ADR-0024 (inventory ledger), ADR-0018 (approval requests); Business Spec Q105–Q107, Q118–Q120, R19, Audit Correction 6; User Flows §14.4; DB Design §11, v1.1 and "v1.2 TASK-024 Amendments"; API Contract §21, v1.1 "Supplier finance" and "TASK-024 Amendments"

## 1. Design

- Tables `supplier_returns` (`SR-000001` numbers), `supplier_return_items`, `supplier_payments` and `supplier_ledger_entries`. Module `src/server/modules/purchasing/` (`supplier-returns.ts`, `supplier-returns-service.ts`, `supplier-ledger.ts`).
- **Returns** (`SUPPLIER_RETURN_MANAGE`) send back damaged units of a purchase order's goods receipt lines, so every return points at the receipt it came from (Q106). A line can return at most the receipt line's damaged units minus those held by other pending, approved or settled returns. Drafts hold nothing, so an abandoned draft blocks nothing; the check runs again at submit and at approval, under the purchase order lock. Expected amount = Σ quantity × the purchase line's unit cost (Q120).
- **Lifecycle**: `DRAFT` → `PENDING_APPROVAL` → `APPROVED` → `SETTLED`, or `REJECTED`. Approval writes one `SUPPLIER_RETURN` inventory movement per line (Damaged −quantity, with the unit cost). If Damaged stock is lower than needed (e.g. written off since), approval is refused and the request stays pending.
- **Ledger** (Audit Correction 6, Q119): append-only entries per supplier. `CREDIT` raises what we owe and `DEBIT` lowers it; the balance is Σ CREDIT − Σ DEBIT. Invoices are `INVOICE` (CREDIT), payments are `PAYMENT` (DEBIT), return credits are `CREDIT` (DEBIT) and cash refunded by the supplier is `REFUND` (CREDIT). A database check ties each type to its direction and its source row.
- **Payments** (`SUPPLIER_PAYMENT_MANAGE`, `Idempotency-Key`, as in ADR-0028) may name a purchase order of the supplier. The supplier row is locked to serialize retries.
- **Q118 payment status** is derived per invoiced purchase order from its ledger entries: nothing left to pay is Paid, otherwise any payment makes it Partially Paid, otherwise Unpaid. Nothing is stored.
- `GET /ledger` and `/balance` need `SUPPLIER_FINANCE_VIEW` (API "TASK-002A Amendments"). Returns can be read by `SUPPLIER_RETURN_MANAGE`, `SUPPLIER_FINANCE_VIEW` or `SUPPLIER_PAYMENT_MANAGE`.

## 2. Out of scope

Corrections of mistaken ledger entries (`ADJUSTMENT`), editing or cancelling return drafts, shipping documents for returns, payment documents/files, and dashboard screens.

## 3. Decisions by the product owner (2026-10-03)

1. **Invoices create payables.** Each recorded invoice adds an `INVOICE` entry for its total; the migration adds entries for invoices recorded before.
2. **Owner/Admin review** (Q105) uses an approval request of the new type `SUPPLIER_RETURN` (`APPROVAL_RESOLVE`, never one's own). A return submitted by an Owner/Admin (`PURCHASE_APPROVE`) is approved at once, as with purchase orders. Rejection is final. This adds supplier returns to the R19 list of approval-request uses.
3. **Stock leaves Damaged on approval.** `APPROVED` means sent back; there is no separate shipping step, so `SHIPPED` / `RECEIVED_BY_SUPPLIER` (DB Design §11) are not created.
4. **Settlement by method** (Q107, Q120). The amount defaults to the expected amount; a different amount needs a note. `CREDIT`: one `CREDIT` entry. `REFUND`: a `CREDIT` entry (goods returned) and a `REFUND` entry (cash received), so the balance nets to zero. `OTHER` (e.g. replacement goods): no entry, amount 0, note required.
5. **Payments**: partial payments and overpayments are allowed; a negative balance means the supplier owes us or holds our advance.
6. **No corrections in v1.** Entries are never changed; a correction flow (`ADJUSTMENT` with its own permission and approval) is `[BUSINESS DECISION REQUIRED]` for a later task.

## 4. Technical defaults (awaiting the product owner's confirmation)

1. Only units damaged on receipt can be returned, line by line against their goods receipt line; damaged units from other sources (customer returns, manual damage) are not.
2. Settlement is recorded only after approval (`APPROVED` → `SETTLED`), by `SUPPLIER_PAYMENT_MANAGE`.
3. Payment methods: `CASH`, `BANK_TRANSFER`, `CHEQUE`, `OTHER`. A payment may name one purchase order of the supplier (approved or later, not cancelled).
4. Payments are recorded for active and inactive suppliers alike (money can still be owed).
5. Supplier returns have no draft editing or cancelling endpoint; an unwanted draft is left as it is and holds no units.

## Consequences

- Migration `supplier_returns_ledger`: four tables, five enums, one sequence, checks, append-only triggers, `SUPPLIER_RETURN` in `inventory_movement_type` and `approval_type`, and the invoice backfill (ids from `gen_random_uuid()`).
- `recordInvoice` (TASK-023) also writes the ledger entry in its transaction.
- No new dependency.
