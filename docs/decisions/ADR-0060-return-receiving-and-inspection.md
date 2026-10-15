# ADR-0060 — Return Receiving and Inspection

- **Status:** Accepted (TASK-039)
- **Date:** 2026-10-16
- **Relates to:** ADR-0056 (approval and pickup), ADR-0049 (return requests), ADR-0021 (uploads), ADR-0025 (inventory movements); Business Spec Q29, Q30, Q34–Q36, Q94–Q96, Q108, Q109; User Flows §11.2, §11.4; API §17, §28, §31 and "TASK-039 Amendments"; DB Design §12 and "v1.2 TASK-039 Amendments"

## 1. Moves

Two moves join the transition table (`requiredStatusFor`): `PICKUP_SCHEDULED → RECEIVED` (`RECEIVE_RETURN`, sets `received_at`, writes the `RETURN_RECEIVED` outbox event of API §31) and `RECEIVED → INSPECTING` (`INSPECT_RETURN`, Q94). Both go through the TASK-038 staff transition: return row lock, status history row and audit entry in one transaction. The return stays `INSPECTING` after every line is inspected; completion and refunds are TASK-040/041.

## 2. Per-line, per-unit outcomes

Q30/Q35/Q95: a line's units are split across outcomes (e.g. 2 Restock + 1 Damaged). `return_inspections` holds one row per outcome (`result`, `condition`, `quantity`, `notes`, inspector, time) instead of a single `resolution` on `return_items`, because one line can have several outcomes. A line is inspected once, while the return is `INSPECTING`, and the quantities must add up to the returned quantity. `result` is `RESTOCK | DAMAGED | REJECTED`; `RETURN_TO_CUSTOMER` is the customer-caused resolution of R7 and comes with TASK-040. `condition` is the DB Design §12 list; the only rule between the two is that `RESTOCK` needs `SELLABLE` (Q36), also a database check. Rows are append-only.

## 3. Restock at inspection

Q36 adds stock once inspection confirms sellable condition. Restocked units therefore go back to Available when the line is inspected, through one `CUSTOMER_RETURN_RESTOCK` movement (reference `RETURN`, the return id) in the same transaction; the balance trigger applies it. This moves the "add sellable quantities" step out of the DB Design "Return completion" atomic list (DB Design is lower than the Business Spec), so a completed inspection never waits for refunds to make stock sellable. Damaged and rejected units change no stock for now (open item: Damaged bucket, physical return to the customer).

## 4. Concurrency

The inspection locks the return row before checking status and earlier inspections, so two inspectors of one line, or an inspection racing a status move, are serialized; the loser gets `409`. One variant is touched per call, so the balance row lock cannot deadlock.

## 5. Staff photos

A new upload purpose `RETURN_INSPECTION` (upload: `INSPECT_RETURN`; view: `RETURNS_VIEW` or `INSPECT_RETURN`) keeps staff photos apart from customer evidence. They are linked to the line in `return_inspection_evidence` (append-only, a file attached once) and shown on `adminReturn` only.

## Consequences

- TASK-040 reads `return_inspections` for refund eligibility and adds the R7 resolution; TASK-041 completes the return without touching stock for restocked units.
- Missing units, inspection corrections and the stock effect of damaged/rejected units are open items in the task file.
