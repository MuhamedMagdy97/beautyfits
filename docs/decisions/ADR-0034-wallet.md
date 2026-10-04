# ADR-0034 — Wallet Ledger and Reservations

- **Status:** Accepted (TASK-028)
- **Date:** 2026-10-04
- **Relates to:** ADR-0010 (transactions), ADR-0025 (inventory reservations), ADR-0029 (supplier ledger idempotency); Business Spec Q26, Q78, Q166–Q170, C4, Audit Correction 5, R34; User Flows §12; Architecture §15; DB Design §13 and "v1.2 TASK-028 Amendments"; API Contract §18 and "TASK-028 Amendments"

## 1. Ledger

- One wallet per customer, created empty on the first credit. Every balance change is one append-only `wallet_transactions` row (Q170). As for inventory (ADR-0025), a database trigger applies it to `wallets.balance`; the balance cannot be written any other way and has a `>= 0` check, so a bug cannot overdraw or silently change a wallet.

## 2. Reservations

- Checkout holds credit with `reserveWallet` (C4, Q167, Q168): available = balance − active reservations; at most one active reservation per order. Release (cancel/expiry) writes no ledger entry: nothing was spent (Audit Correction 5). Capture marks the reservation `CAPTURED` and writes the `ORDER_WALLET_USE` debit. Refunds use `creditWallet`.
- All four run in the caller's transaction (`src/server/modules/wallet/wallet-service.ts`) and lock the wallet row first, so two orders cannot spend the same credit; release and capture are idempotent.

## 3. Manual adjustment

- `ADJUST_WALLET` (Owner/Admin only, Q78): credit or debit with a reason, idempotent (`Idempotency-Key`, operation `WALLET_ADJUSTMENT`), audited `WALLET_ADJUSTED`. A debit takes only available credit, never credit held for an order. Deactivated customers cannot be adjusted (their balance was zero, R34).
- Customers see their ledger without the staff reason (it may be an internal note); staff see it.

## Consequences

- Migration `wallet`: enums `wallet_transaction_type`, `wallet_direction`, `wallet_reservation_status`; tables `wallets`, `wallet_transactions`, `wallet_reservations`; checks and triggers.
- Deactivation (R34) is refused while the balance is not zero.
- When the reservation is captured (shipped, delivered or another outcome) is decided with the order tasks (TASK-030 → TASK-034); this task only provides the function.
- No new dependency.
