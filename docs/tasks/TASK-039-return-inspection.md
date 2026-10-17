# TASK-039 — Return Receiving & Inspection

## Goal

Staff receive the parcel of a picked-up return, start its inspection and record, per returned line, the outcome of each unit (Restock / Damaged / Rejected) with its condition, notes and photos. Units found sellable go back to Available stock through the inventory ledger.

## Dependencies

TASK-038 (approval, pickup, status history, ADR-0056), TASK-019 (inventory ledger), TASK-016 (uploads), TASK-013 (audit logs).

## Source of Truth

- Business Spec Q29, Q30, Q34–Q36, Q94–Q96, Q108, Q109
- User Flows §11.2, §11.4
- DB Design §12, §(atomic operations: return completion), "v1.2 TASK-039 Amendments"
- API Contract §17 (admin), §28, §31, "TASK-039 Amendments"
- Permission catalog (`RECEIVE_RETURN`, `INSPECT_RETURN`, `RETURNS_VIEW`)

## Scope

- `POST /admin/returns/{returnId}/receive` (`PICKUP_SCHEDULED → RECEIVED`), `POST /admin/returns/{returnId}/start-inspection` (`RECEIVED → INSPECTING`).
- `POST /admin/return-items/{returnItemId}/inspection`: per-line outcomes split by quantity, with condition, notes and staff photos.
- `CUSTOMER_RETURN_RESTOCK` inventory movement for restocked units, in the same transaction.
- Upload purpose `RETURN_INSPECTION` for staff photos.

## Non-Goals

- The customer-caused resolution (`RETURN_TO_CUSTOMER` / partial refund, R7), refund amounts, `final_responsibility`, the pickup fee (TASK-040); completion and wallet refunds (TASK-041); notification templates; UI.

## Files / Modules

- `src/server/modules/returns/returns.ts`, `returns.test.ts`, `returns-service.ts`, `schemas.ts`
- `src/server/modules/media/uploads-service.ts`, `schemas.ts` (purpose `RETURN_INSPECTION`)
- `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/returns/[returnId]/receive|start-inspection/route.ts`, `src/app/api/v1/admin/return-items/[returnItemId]/inspection/route.ts`
- `src/app/api/v1/returns/returns-routes.int.test.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261016039000_return_inspection/`
- Docs: ADR-0060, API / DB "TASK-039 Amendments", roadmap

## Business Rules

- Q29: receive → inspect → refund; nothing is refunded here.
- Q94: warehouse / authorized employees receive and inspect (`RECEIVE_RETURN`, `INSPECT_RETURN`; Warehouse roles have both).
- Q30, Q34, Q35, Q95, Q96: each returned line is inspected on its own, its units split across Restock / Damaged / Rejected (e.g. 2 Restock + 1 Damaged), with notes.
- Q36, Q108: only units in sellable condition are restocked, into Available, with an inventory movement; damaged/opened/rejected units never enter sellable stock.

## API Changes

API Contract "TASK-039 Amendments".

## Database Changes

Migration `20261016039000_return_inspection`; DB Design "v1.2 TASK-039 Amendments".

## Security / Authorization

`receive` needs `RECEIVE_RETURN`; `start-inspection` and item inspection need `INSPECT_RETURN`, enforced server-side on employee sessions. Every write locks the return row (`FOR UPDATE`) and writes history/audit in the same transaction. Inspection photos are `RETURN_INSPECTION` uploads (upload: `INSPECT_RETURN`; view: `RETURNS_VIEW` or `INSPECT_RETURN`); inspections are shown on `adminReturn` only. Logs carry ids only.

## Acceptance Criteria

- `receive` only from `PICKUP_SCHEDULED`, `start-inspection` only from `RECEIVED`; otherwise `409 RETURN_STATE_INVALID` with the required status. Both add a status history row and an audit entry; `receive` sets `receivedAt` and writes `RETURN_RECEIVED` (API §31).
- A line is inspected once, only while `INSPECTING`; its outcome quantities sum to the returned quantity; `RESTOCK` requires condition `SELLABLE`.
- Restocked units add to Available through one `CUSTOMER_RETURN_RESTOCK` movement (reference `RETURN`) in the same transaction; other outcomes change no stock.
- Inspection rows and photos are append-only.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/returns/returns-routes.int.test.ts` ("receiving and inspection (TASK-039)"): moves and illegal moves, validation, per-unit split with notes and photo, restock movement and balance, rejected line without stock change, once per line, photo reuse, customer view, append-only, concurrent inspection of one line (one restock), permissions.
- Unit `src/server/modules/returns/returns.test.ts`: new moves, `checkInspection`, `restockQuantity`.

## Edge Cases

- Two inspectors on one line: the return row lock serializes them; the second gets `409` (`RETURN_ITEM_ALREADY_INSPECTED`), stock moves once.
- Receive or inspect while another move happens: same lock; the later request sees the new status.
- All lines inspected: the return stays `INSPECTING` until completion (TASK-040/041).

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- Resolved (owner decision 2026-10-18): keep current behaviour — damaged and rejected units are recorded but enter no inventory bucket; what happens physically to rejected units stays outside the system (BD-008).
- Resolved (owner decision 2026-10-18): not in v1; keep as is — no "not received" outcome; every requested unit must get an inspection outcome (BD-009).
- Resolved (owner decision 2026-10-18): keep current behaviour — an inspection is final once saved (audited); no correction flow (BD-010).
- Resolved (owner decision 2026-10-18): keep current behaviour — inspection notes are optional per outcome (BD-011).
- Resolved (owner decision 2026-10-18): keep current behaviour — customers see the return status and `receivedAt` only (BD-012).
- Resolved (owner decision 2026-10-18): not in v1; keep as is — the `RETURN_RECEIVED` outbox event is recorded, but no customer message is sent (BD-007).
- Note (doc conflict): DB Design "Return completion must atomically … add sellable quantities to inventory when restocked" places the restock at completion, while Business Spec Q36 (higher) says stock is added once inspection confirms sellable condition. Implemented per Q36 at item inspection; the DB Design TASK-039 amendment records this. Completion (TASK-041) no longer restocks.
- Note: `condition` (DB Design §12) is recorded with each outcome; the only rule enforced between them is `RESTOCK ⇒ SELLABLE` (Q36).

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [x] Reviewed
- [x] Done
