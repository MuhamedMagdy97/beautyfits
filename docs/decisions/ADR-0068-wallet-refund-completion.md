# ADR-0068 — Return Completion and Wallet Refund

- **Status:** Accepted (TASK-041)
- **Date:** 2026-10-17
- **Relates to:** ADR-0066 (refund calculation), ADR-0034 (wallet ledger and reservations), ADR-0060 (restock at inspection), ADR-0035 (discount per line), ADR-0010 (transactions); Business Spec Q16, Q26, Q29, Q97, R7, R9, R34, R38.7; User Flows §11.6, §12.1; API §9, §17, §31 and "TASK-041 Amendments"; DB Design §12, "Return financials" and "v1.2 TASK-041 Amendments"

## 1. One completion transaction

`POST /admin/returns/{returnId}/complete` (`COMPLETE_RETURN`, `Idempotency-Key` required) moves `INSPECTING → COMPLETED` in one transaction under the return row lock (`FOR UPDATE`):

1. Calls `loadReturnRefund` (ADR-0066) and requires `READY`.
2. Stores each line's `refund_eligible_amount` and `deduction_amount` and the return's `refund_total` and `completed_at`.
3. Credits `refund_total` to the customer's wallet with `creditWallet` (`RETURN_REFUND`, reference `RETURN` / return id), when it is above zero. A refund of zero (everything rejected or sent back) completes without a ledger entry.
4. Writes the status history, the audit entry `RETURN_COMPLETED` (breakdown and wallet transaction id) and the outbox event `RETURN_COMPLETED`. Notifications run after commit (§31).

Stock is not touched: sellable units were restocked at inspection (ADR-0060).

## 2. Amounts fixed at completion

Before completion the refund is calculated live; a later rejection or cancellation of an earlier return of the same line can move it by a piastre (ADR-0066). The stored amounts are the record from completion on: `loadReturnRefund` reports them for a completed return (`withFixedAmounts`), the delivery fee refund being the stored total minus the stored line refunds.

## 3. At most one credit

- The return row lock serializes completions. A retry with the same key (same employee) returns the completed return; any other completion gets `409 RETURN_STATE_INVALID` (`status: COMPLETED`). The key is stored in `idempotency_keys` (operation `RETURN_COMPLETE`, 7 days) in the same transaction, so a refused attempt leaves nothing behind.
- Backstop: the partial unique index `wallet_transactions_one_return_refund_key` allows one `RETURN_REFUND` per return id.
- Check constraints tie `refund_total` / `completed_at` to `status = COMPLETED`, and a line's two amounts to each other.

## 4. Wallet reservations

Nothing to release or capture: a reservation is captured when its order ships (R38.7, ADR-0034), and only delivered orders can be returned. The refund is ordinary credit, available at once (C4: available = balance − active reservations).

## 5. Who is refunded

Returns are customer-only (TASK-037: guest orders cannot be returned), and R34 keeps the account while a return is open. A return without a customer is refused (`409 CONFLICT RETURN_HAS_NO_CUSTOMER`) rather than losing the credit.

## Consequences

- Migration `20261017041000_wallet_refund_completion`: four nullable columns, two checks, one partial unique index.
- `return` gains `completedAt` and `refundTotal`; `adminReturn.items[]` gains `refundAmount` and `deductionAmount`. The staff return screen offers "Complete" while `INSPECTING`; the storefront shows the refunded total.
- `PARTIALLY_COMPLETED` stays unused; that, staff completion (Q97) and no pickup fee settlement (ADR-0066) are kept by the owner decision of 2026-10-18 (task file).
