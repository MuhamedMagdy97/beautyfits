# TASK-038 — Return Approval & Carrier Pickup

## Goal

Staff review return requests waiting in `Pending Approval`: approve or reject them with a reason, then ask a carrier to collect approved returns from the customer, recording who pays that carrier. Every status change of a return is kept in a status history.

## Dependencies

TASK-037 (return requests, ADR-0049), TASK-027/034 (shipping companies), TASK-013 (audit logs).

## Source of Truth

- Business Spec Q5, Q90–Q93, Q99, C2, R18, R19
- User Flows §11.2, §11.3
- Architecture §14
- DB Design §12, "v1.2 TASK-038 Amendments"
- API Contract §17 (admin), §31, "TASK-038 Amendments"
- Permission catalog (`APPROVE_RETURN`, `MANAGE_RETURNS`, `RETURNS_VIEW`)

## Scope

- `POST /admin/returns/{returnId}/approve`, `/reject`, `/pickup`.
- `return_status_history` for every return move (customer request and withdrawal included, backfilled for earlier returns).
- Approval, rejection and pickup fields on `returns`; outcome fields on the customer and admin return views; history on the admin view.
- Outbox event `RETURN_APPROVED` (API §31).

## Non-Goals

- Receive, inspection, resolution, completion and refunds (TASK-039–041); the return pickup fee amount and `final_responsibility` (TASK-040); notification templates; UI.

## Files / Modules

- `src/server/modules/returns/returns.ts`, `returns.test.ts`, `returns-service.ts`, `schemas.ts`
- `src/server/modules/audit/audit.ts`, `src/server/modules/shipping/schemas.ts` (tracking number rule exported)
- `src/app/api/v1/admin/returns/[returnId]/approve|reject|pickup/route.ts`
- `src/app/api/v1/returns/returns-routes.int.test.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261015038000_return_approval/`
- Docs: ADR-0056, API / DB "TASK-038 Amendments", roadmap

## Business Rules

- Q5, Q91: requests go to staff first; they review eligibility, reason and evidence and approve or reject.
- Q92: a rejection is final and never rewritten; the customer submits a new request (reason shown to them).
- Q93: BeautyFits contacts the carrier to collect from the customer.
- C2, User Flows §11.3: the customer pays the carrier for the pickup by default; BeautyFits pays for its own errors, wrong items and carrier damage; the final responsibility is assessed after inspection (Q99).
- R18: `APPROVE_RETURN` is in no default role. R19: no approval request for these moves.
- Q90: the order is not changed.

## API Changes

API Contract "TASK-038 Amendments".

## Database Changes

Migration `20261015038000_return_approval`; DB Design "v1.2 TASK-038 Amendments".

## Security / Authorization

Approve/reject need `APPROVE_RETURN`, pickup needs `MANAGE_RETURNS`, enforced server-side on employee sessions. Each move locks the return row and writes the status history and the audit entry in the same transaction. Logs carry ids only.

## Acceptance Criteria

- A `PENDING_APPROVAL` return can be approved (optional note) or rejected (reason required); any other status: `409 RETURN_STATE_INVALID` with the required status.
- An `APPROVED` return can get its pickup with an active carrier, an optional tracking number and the fee payer (default `CUSTOMER`); otherwise `409`.
- Rejected units can be requested again through `resubmit`; approved returns can no longer be withdrawn.
- Every move adds a `return_status_history` row and an audit entry; the history cannot be changed or deleted.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/returns/returns-routes.int.test.ts` ("staff review and pickup"): approve with history/audit/outbox, reject with reason and resubmit, pickup rules and validation, fee payer, permissions, history append-only.
- Unit `src/server/modules/returns/returns.test.ts`: allowed moves (`requiredStatusFor`).

## Edge Cases

- Two reviewers at once: the row lock serializes them; the second gets `409 RETURN_STATE_INVALID`.
- Customer withdrawing while staff approve: same lock; whichever is second gets `409`.
- Inactive or unknown carrier: `400 VALIDATION_ERROR`.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] Pickup fee payer before inspection: C2 bases return shipping on the final assessed responsibility, known only after inspection (Q99), while the carrier must be told at pickup who pays. Implemented: staff record a provisional payer, `CUSTOMER` by default (User Flows §11.3), `BEAUTYFITS` allowed (e.g. a wrong item shown in the photos). Confirm, and decide how a customer who paid is settled when inspection finds BeautyFits/carrier responsibility (TASK-040).
- [BUSINESS DECISION REQUIRED] Changing a scheduled pickup (other carrier, failed or missed pickup, customer unreachable): not possible yet; no rule exists.
- [BUSINESS DECISION REQUIRED] Withdrawal after approval (before pickup): customers can withdraw only while `PENDING_APPROVAL` (TASK-037); should they (or staff) be able to cancel an approved return?
- [BUSINESS DECISION REQUIRED] Customer notifications for approval, rejection and pickup: the `RETURN_APPROVED` outbox event is written (API §31), but no template or channel is defined for it, and none is listed for rejection or pickup.
- Note: the rejection reason is shown to the customer so the new request can correct it (Q92); staff should write it for the customer.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [x] Reviewed
- [x] Done
