# TASK-028 — Wallet Ledger & Reservation

## Goal
Each customer has a wallet whose balance changes only through an append-only ledger. Checkout can hold wallet credit for an order (Wallet + COD split), release it when the order is cancelled or expires, and capture it when the order is completed. Owner/Admin can adjust a wallet manually, giving a reason.

## Dependencies
TASK-007 (customers), TASK-026 (discounts: checkout order of operations), TASK-013 (audit), TASK-005 (idempotency keys, transactions).

## Source of Truth
- Business Spec Q26, Q78, Q80, Q166–Q170, C4, Audit Correction 5, R34
- User Flows §12 (wallet flow)
- Architecture §15 (wallet architecture)
- DB Design §13, "v1.2 TASK-028 Amendments"
- API Contract §18, "TASK-002A Amendments" (idempotency), "TASK-028 Amendments"
- Permission catalog (`VIEW_WALLET_BALANCE`, `ADJUST_WALLET` Owner/Admin only)

## Scope
- `wallets`, `wallet_transactions` (append-only, trigger-applied balance), `wallet_reservations`.
- `reserveWallet`, `releaseWalletReservation`, `captureWalletReservation`, `creditWallet`, run in the caller's transaction.
- `GET /me/wallet`, `GET /me/wallet/transactions`, `GET /admin/customers/{id}/wallet(/transactions)`, `POST /admin/customers/{id}/wallet/adjust`.
- R34: deactivation refused while the balance is not zero.

## Non-Goals
- Using the wallet at checkout and the Wallet + COD split on the order (TASK-029/030); deciding when the order captures (order tasks); return refunds (TASK-040) and `manual-refund`; dashboard and website UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_wallet/`
- `src/server/modules/wallet/` (`wallet-service.ts`, `schemas.ts`), `src/server/modules/customers/profile-service.ts`, `src/server/modules/audit/audit.ts`
- `src/app/api/v1/me/wallet/**`, `src/app/api/v1/admin/customers/[id]/wallet/**`
- Docs: DB Design / API Contract "TASK-028 Amendments", ADR-0034

## Business Rules
- Q170: ledger + derived balance; no balance change without a transaction. Q169: no expiry.
- Q167/Q168/C4: full or partial wallet use, rest COD; credit used by a pending order is held until the outcome.
- Audit Correction 5: releasing a hold is not a refund.
- Q78: manual adjustments Owner/Admin only, immutable transaction with reason, audited.
- R34: no deactivation while the wallet balance is not zero.

## API Changes
API Contract "TASK-028 Amendments" (adds `GET /admin/customers/{id}/wallet/transactions`).

## Database Changes
Migration `wallet`. DB Design "v1.2 TASK-028 Amendments".

## Security / Authorization
Customers see only their own wallet. Admin views need `VIEW_WALLET_BALANCE`; adjustments need `ADJUST_WALLET` (Owner/Admin only), an `Idempotency-Key` and a reason, and are audited. Amounts are validated integers; balances come only from the ledger. Database triggers stop direct balance writes, ledger edits and negative balances.

## Acceptance Criteria
- Every balance change has a ledger row; the balance never goes below zero; ledger rows cannot be changed or deleted.
- Concurrent reservations cannot spend the same credit; one active reservation per order.
- Release writes no ledger entry; capture writes `ORDER_WALLET_USE`; both are idempotent.
- Adjustments are Owner/Admin only, idempotent, audited, and debit only available credit.
- Deactivation is refused while the balance is not zero.
- All required checks pass.

## Tests
- Integration `src/app/api/v1/me/wallet/wallet-routes.int.test.ts`: permissions and validation, adjustment + audit + idempotent replay/conflict, debit vs held credit, deactivated customer, customer views, reserve/release/capture, no wallet, concurrent double-spend, refund credit, database guards, R34.

## Edge Cases
- Wallet 500 and two concurrent orders each asking 300: one holds, one is refused.
- A debit adjustment while credit is held: limited to available credit.
- Capture after release, release of an order that never reserved: no-op.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] When the order captures held credit: at `SHIPPED` (as stock, ADR-0025), at `DELIVERED`, or otherwise (C4 says "finalized according to the order outcome"). Needed by TASK-030 → TASK-034, not by this task.
- Owner to confirm the defaults chosen here (ADR-0034 §3): manual debits are allowed up to available credit; customers do not see staff adjustment reasons.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
