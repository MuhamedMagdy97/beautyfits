# TASK-041 — Wallet Refund Completion

## Goal

Complete an inspected and assessed return: fix its refund amounts and credit the total to the customer's wallet in one transaction, at most once, with history, audit and a notification event after commit.

## Dependencies

TASK-040 (refund calculation, `loadReturnRefund`, ADR-0066), TASK-039 (inspection and restock, ADR-0060), TASK-028 (wallet ledger and reservations, ADR-0034), TASK-002 (idempotency keys).

## Source of Truth

- Business Spec Q16, Q26, Q29, Q97, R7, R9, R34, R38.7 (wallet captured at Shipped)
- User Flows §11.2, §11.6, §12.1, §12.2
- DB Design §12, §13, "Return completion", "Return financials", "v1.2 TASK-041 Amendments"
- API Contract §9, §17 (`complete`), §31, "TASK-041 Amendments"
- Permission catalog (`COMPLETE_RETURN`)
- ADR-0034, ADR-0060, ADR-0066; this task: ADR-0068

## Scope

- `POST /admin/returns/{returnId}/complete` (`COMPLETE_RETURN`, `Idempotency-Key`): `INSPECTING → COMPLETED` when the refund is `READY`.
- Store `returns.refund_total`, `completed_at`, `return_items.refund_eligible_amount`, `deduction_amount`; report them afterwards (`withFixedAmounts`).
- Wallet `RETURN_REFUND` credit through `creditWallet`; at most one per return.
- Status history, audit `RETURN_COMPLETED`, outbox `RETURN_COMPLETED`.
- `return.completedAt` / `refundTotal`, `adminReturn.items[].refundAmount` / `deductionAmount`.
- Staff return screen: "Complete and refund to wallet" while `INSPECTING`, refund total and line amounts once completed. Storefront return detail: the refunded amount once completed.

## Non-Goals

- `PARTIALLY_COMPLETED` (meaning not documented, open item).
- Pickup fee settlement (TASK-040 open item), manual / alternative refund methods (`manual-refund`, Q16 future), refund reversal.
- Screens for the assessment and the R7 decision (TASK-040 endpoints), customer notification templates for return events.
- Stock: restocked at inspection (ADR-0060); damaged / sent-back units stay a TASK-039 open item.

## Files / Modules

- `src/server/modules/returns/returns-service.ts` (`completeReturn`, views), `returns.ts` (transition), `refunds.ts` (`withFixedAmounts`), `refund-calculation.ts` (stored amounts), tests `returns.test.ts`, `refunds.test.ts`
- `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/returns/[returnId]/complete/route.ts`
- `src/app/api/v1/returns/returns-routes.int.test.ts` ("wallet refund completion (TASK-041)")
- `src/app/staff/(shell)/returns/[returnId]/page.tsx`, `src/app/staff/_lib/orders-i18n.ts`
- `src/app/(store)/account/returns/[returnId]/return-detail.tsx`, `src/app/(store)/_lib/account.ts`, `src/app/(store)/_lib/i18n.tsx`
- `prisma/schema.prisma`, `prisma/migrations/20261017041000_wallet_refund_completion/`
- Docs: ADR-0068, decisions README, API / DB "TASK-041 Amendments", roadmap

## Business Rules

- Q29, Q97: no refund before receipt and inspection; the eligible amount (TASK-040 calculation) is refunded without manual entry; R7 cases need their human decision first (refund `READY`).
- Q16, Q26: the refund goes to the wallet (MVP default), as one ledger credit; the balance never changes without one (ADR-0034).
- Completion adds no stock (Q36, ADR-0060).
- Wallet reservations: captured at Shipped (R38.7); a return needs a delivered order, so completion releases or captures nothing. The credit is available at once.

## API Changes

API Contract "TASK-041 Amendments".

## Database Changes

Migration `20261017041000_wallet_refund_completion`; DB Design "v1.2 TASK-041 Amendments".

## Security / Authorization

`COMPLETE_RETURN` (not in any default role, R18). The client sends no amount: everything comes from `loadReturnRefund` inside the transaction. The return row lock serializes completion with the assessment, resolution and inspection writes. Idempotency keys are scoped to the employee. No sensitive data in logs (ids and the total only).

## Acceptance Criteria

- Only `INSPECTING` returns complete (`409 RETURN_STATE_INVALID`); only with a `READY` refund (`409 CONFLICT REFUND_NOT_READY` + `refundStatus`).
- One transaction stores the amounts, credits the wallet (none for 0), writes history, audit and outbox.
- A retried or concurrent completion never credits twice; the same key replays `200`.
- Completed returns report the stored amounts.
- All required checks pass.

## Tests

- Unit `returns.test.ts`: `INSPECTING → COMPLETED` only. `refunds.test.ts`: `withFixedAmounts` replaces a drifted calculation.
- Integration `returns-routes.int.test.ts` ("wallet refund completion (TASK-041)"): full completion (amounts, wallet balance and ledger entry, history, audit, outbox, no stock move, refund view, customer view), replay and second-key refusal, key reused for another return; three racing completions → one credit, plus the unique index refusing a second `RETURN_REFUND`; zero refund without a wallet entry; state, readiness, key, permission and 404 checks.

## Edge Cases

- Two staff complete at once: the row lock serializes; the second sees `COMPLETED` (`409`) or replays its own key.
- A lost answer: the staff screen keeps one key per card, so a retry replays.
- Refund of zero: completes, no wallet row (the ledger takes only positive amounts).
- Earlier return of the same line released after completion: the stored amounts stand.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] `PARTIALLY_COMPLETED` (DB Design §12 status) has no documented meaning. Completion goes `INSPECTING → COMPLETED` only. Decide whether part of a return can be completed and refunded while other lines wait, or drop the status.
- [BUSINESS DECISION REQUIRED] Q97 says "auto-refund eligible amount to Wallet after completed inspection"; API §17 and the permission catalog make completion a `COMPLETE_RETURN` staff action that creates the refund automatically. Implemented per the contract (staff click, amount never entered by hand). Confirm, or decide that the system completes on its own once the refund is `READY`.
- [BUSINESS DECISION REQUIRED] Pickup fee settlement (carried from TASK-040, ADR-0056 §4): completion credits `totalRefund`, which does not add or deduct the pickup fee when the payer changed. Once completed the amount is final; any correction is a manual wallet adjustment (`ADJUST_WALLET`).
- Note: customer notification wording for `RETURN_COMPLETED` is not written (as for `RETURN_APPROVED` / `RETURN_RECEIVED`); the outbox event carries the data. §31 also lists `WALLET_REFUNDED`; it is not emitted separately, `RETURN_COMPLETED` carries `walletTransactionId`.
- Note: guest returns cannot exist (TASK-037) and R34 blocks deactivation while a return is open; a return without a customer is refused (`RETURN_HAS_NO_CUSTOMER`), not credited.
- Note: the roadmap's "reservation release/consumption rules" are already settled (R38.7: captured at Shipped, TASK-036); nothing is held when a return completes.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
