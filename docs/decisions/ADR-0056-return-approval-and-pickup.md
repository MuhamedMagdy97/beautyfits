# ADR-0056 — Return Approval and Carrier Pickup

- **Status:** Accepted (TASK-038)
- **Date:** 2026-10-15
- **Relates to:** ADR-0049 (return requests), ADR-0018 (audit logs), ADR-0036 (order status history), ADR-0040 (shipping companies); Business Spec Q5, Q90–Q93, Q99, C2, R18, R19; User Flows §11.2–§11.3; API §17, §31 and "TASK-038 Amendments"; DB Design §12 and "v1.2 TASK-038 Amendments"

## 1. Staff moves and their permissions

Three moves are added to the return lifecycle: `PENDING_APPROVAL → APPROVED` and `PENDING_APPROVAL → REJECTED` (`APPROVE_RETURN`; Q91, Q92) and `APPROVED → PICKUP_SCHEDULED` (`MANAGE_RETURNS`; Q93). The allowed moves live in one table (`requiredStatusFor` in `src/server/modules/returns/returns.ts`) that the customer withdrawal uses too; any other move is `409 RETURN_STATE_INVALID` with the status it needs. Each move locks the return row (`FOR UPDATE`), so two reviewers cannot both decide. No approval request is used (R19 keeps the approval mechanism for other flows); `APPROVE_RETURN` is in no default role, so Owner/Admin decide unless they grant it (R18). The order is never touched (Q90).

## 2. Status history

`return_status_history` is a separate append-only table, like `order_status_history`: one row per move (customer request and withdrawal included) with who, why and when, written in the same transaction as the move and its audit entry. The migration backfills the rows of returns requested before it. Staff see the history on `adminReturn`; customers see the outcome fields only (`approvedAt`, `rejectedAt`, `rejectionReason`, `pickup`).

## 3. Rejection reason

A reason is required to reject and is stored on the return (`rejection_reason`) and in the history. It is shown to the customer, because Q92 has them submit a new, corrected request. The rejected return is never changed again.

## 4. Pickup and who pays the carrier

Q93: BeautyFits asks a carrier to collect the parcel; the customer does not deliver it. `pickup` records the carrier (an active shipping company), an optional tracking number, the time and `pickup_fee_payer`. C2 says the customer pays the carrier directly for customer-caused and change-of-mind returns and BeautyFits pays for its own errors, wrong items and carrier damage, based on the final assessed responsibility. That assessment happens after inspection (Q99), but the carrier must know at pickup who pays, so the pickup records a provisional payer: `CUSTOMER` by default (User Flows §11.3, "customer pays return shipping by default"), or `BEAUTYFITS` when staff choose it. The pickup fee amount, `final_responsibility` and any settlement when the final responsibility differs belong to the refund rules (TASK-040). Whether staff may choose `BEAUTYFITS` before inspection is an open item for the owner.

## 5. Events

Approval writes the `RETURN_APPROVED` outbox event listed in API §31, in the same transaction. No notification template consumes it yet; rejection and pickup write no event (none is listed).

## Consequences

- TASK-039 continues from `PICKUP_SCHEDULED` (`receive`), adding its moves to the same table and history.
- Changing a scheduled pickup (another carrier, a failed pickup) and withdrawing after approval are not possible yet; see the task's open items.
