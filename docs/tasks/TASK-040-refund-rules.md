# TASK-040 — Refund Calculation & Resolution Rules

## Goal

After a return is inspected, staff record the final responsibility (customer, BeautyFits or carrier) and, for customer-caused damaged units, the R7 decision (send back with no refund, or keep and refund the configured 25%). The backend then calculates the refund of each line and of the return: full or partial product refunds, the original delivery fee when BeautyFits or the carrier is at fault, and who should have paid the pickup. TASK-041 completes the return and credits the wallet from this calculation.

## Dependencies

TASK-039 (inspection outcomes, ADR-0060), TASK-038 (pickup fee payer, ADR-0056), TASK-028 (wallet, ADR-0034), TASK-029 (discount shares per line, ADR-0035), TASK-057 (critical settings).

## Source of Truth

- Business Spec Q15, Q16, Q26, Q29, Q96–Q99, Q180, Q181, C2, C3, R7, R9, R18; "Discount per item" (returns refund net of the share)
- User Flows §11.3, §11.5, §11.6
- DB Design §12, "Return financials", "v1.2 TASK-040 Amendments"
- API Contract §17 (`resolution`), "TASK-040 Amendments"
- Permission catalog (`COMPLETE_RETURN`, `RESOLVE_CUSTOMER_CAUSED_RETURN`, `RETURNS_VIEW`)
- ADR-0034, ADR-0035, ADR-0056, ADR-0060; this task: ADR-0066

## Scope

- `POST /admin/returns/{returnId}/assessment`: final responsibility (`CUSTOMER` | `BEAUTYFITS` | `CARRIER`), optional pickup fee amount and notes; once, after every line is inspected.
- `POST /admin/return-items/{returnItemId}/resolution` (`RESOLVE_CUSTOMER_CAUSED_RETURN`): the R7 decision for a line's customer-caused damaged units; once per line; the rate in force is stored with it.
- `GET /admin/returns/{returnId}/refund` (`RETURNS_VIEW`): the refund calculation as it stands.
- Pure rules `src/server/modules/returns/refunds.ts` and the DB reader `loadReturnRefund` (`refund-calculation.ts`), the seam TASK-041 calls inside its completion transaction.
- Critical setting `returns.customer_caused_refund_basis_points` (default 2500 = 25%, R7).

## Non-Goals

- Return completion, wallet credits, `refund_total`, `completed_at`, reservation release/consumption (TASK-041).
- `manual-refund` / alternative refund methods (Q16: future, `MANAGE_MANUAL_REFUNDS`).
- Settling a pickup fee payer that changed after assessment (open item).
- Stock effect of damaged / sent-back units (TASK-039 open item); dashboard and storefront screens; notifications.

## Files / Modules

- `src/server/modules/returns/refunds.ts`, `refunds.test.ts`, `refund-calculation.ts`, `returns-service.ts`, `schemas.ts`
- `src/server/modules/settings/settings.ts`, `src/server/modules/bootstrap/bootstrap.test.ts`, `src/app/staff/(shell)/_admin/kit.tsx` (setting label)
- `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/returns/[returnId]/assessment/route.ts`, `.../[returnId]/refund/route.ts`, `src/app/api/v1/admin/return-items/[returnItemId]/resolution/route.ts`
- `src/app/api/v1/returns/returns-routes.int.test.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261017040000_refund_rules/`
- Docs: ADR-0066, API / DB "TASK-040 Amendments", roadmap, decisions README

## Business Rules

- Q29, Q97: refunds come after inspection; the eligible amount is refunded automatically, customer-caused damage is a human-resolved exception (R7).
- Q99: the customer's reason and the final assessed responsibility are distinct; the assessment is recorded after inspection.
- Paid amount: a unit refunds its share of the order line total, which is net of the line's discount share (ADR-0035). Shares are cumulative HALF-UP over the line's units (R9), so the returns of one line never add up to more than the line total.
- Restocked units refund in full. Rejected units refund nothing (not returnable). Damaged units refund in full when BeautyFits or the carrier is responsible (User Flows §11.6); when the customer is, R7 applies: `RETURN_TO_CUSTOMER` → no refund; `KEEP_PARTIAL_REFUND` → the configured share (default 25%, HALF-UP), the rest is the deduction.
- C3: the original delivery fee is refunded only when BeautyFits or the carrier is responsible, once per order (the first such return assessed); customer-caused / change-of-mind returns get the product refund only.
- C2: the pickup is paid by the customer for customer-caused returns, by BeautyFits otherwise, based on the assessment; the calculation reports the provisional payer (pickup), the final payer and whether they differ.
- R7, Q180, Q181: the 25% is a critical setting (Owner/Admin approval to change); the rate used is stored with the decision; the decision and deduction are in the audit trail.

## API Changes

API Contract "TASK-040 Amendments".

## Database Changes

Migration `20261017040000_refund_rules`; DB Design "v1.2 TASK-040 Amendments".

## Security / Authorization

`assessment` needs `COMPLETE_RETURN` (provisional, see open items); `resolution` needs `RESOLVE_CUSTOMER_CAUSED_RETURN`; `refund` needs `RETURNS_VIEW`. Neither write permission is in a default role (R18). Both writes lock the return row (`FOR UPDATE`), are once-only and write an audit entry in the same transaction. All amounts are computed server-side from the order snapshot; the client sends none except the carrier's pickup fee, which is recorded only. The customer view is unchanged.

## Acceptance Criteria

- Assessment only while `INSPECTING`, after every line is inspected (`409 CONFLICT INSPECTION_INCOMPLETE`), once (`RETURN_ALREADY_ASSESSED`).
- Resolution only while `INSPECTING`, for a return assessed `CUSTOMER` (`RESPONSIBILITY_NOT_CUSTOMER`), on a line with damaged units (`NO_CUSTOMER_CAUSED_UNITS`), once (`RETURN_ITEM_ALREADY_RESOLVED`).
- The refund calculation reports `INSPECTION_REQUIRED` → `ASSESSMENT_REQUIRED` → `RESOLUTION_REQUIRED` → `READY`, with amounts only when `READY`.
- Amounts follow the business rules above, in integer piastres, HALF-UP.
- All required checks pass.

## Tests

- Unit `src/server/modules/returns/refunds.test.ts`: cumulative unit shares, full / discounted / rejected / carrier-damaged lines, delivery fee once, R7 both outcomes and HALF-UP, status progression, final pickup payer.
- Unit `bootstrap.test.ts`: setting default 2500, critical, range.
- Integration `returns-routes.int.test.ts` ("refund rules (TASK-040)"): carrier damage with delivery fee and changed pickup payer; customer-caused R7 keep + send back with audit; once-only and order checks; permissions; 404s.

## Edge Cases

- Two staff assess or resolve at once: the return row lock serializes them; the second gets `409`.
- Several returns of one order line: cumulative shares keep the total within the line total. If an earlier return is later rejected or cancelled, a later return's share can move by one piastre until TASK-041 fixes amounts at completion.
- Several store-fault returns of one order: only the first assessed one gets the delivery fee.
- Setting changed between decision and completion: the stored rate is used.

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] Who records the final responsibility (Q99)? It decides the refund (R7, delivery fee), so it is gated by `COMPLETE_RETURN` (Owner/Admin by default, R18) for now. Alternatives: `INSPECT_RETURN` (the inspector) or a dedicated permission.
- [BUSINESS DECISION REQUIRED] Pickup fee settlement (C2, ADR-0056 §4): when the provisional payer at pickup differs from the final responsibility (e.g. the customer paid the carrier but the carrier damaged the item), should BeautyFits add the fee to the refund, and in the reverse case may it deduct it? The calculation reports `pickupFee.payerChanged` and the amount; nothing is added or deducted.
- [BUSINESS DECISION REQUIRED] Delivery fee on a partial store-fault return (C3): implemented as the full original fee, once per order (first store-fault return assessed). Confirm, or prorate.
- [BUSINESS DECISION REQUIRED] Rejected units: implemented as no refund (they are "not returnable", owner decision 2026-10-15 for opened change-of-mind units). Confirm for all claim types, and what happens to the physical unit.
- [BUSINESS DECISION REQUIRED] R7 per unit or per line: one decision covers all customer-caused damaged units of a line. Confirm whether staff must be able to split a line (e.g. keep one unit, send one back).
- [BUSINESS DECISION REQUIRED] Correcting an assessment or a resolution: both are final once recorded (audited). Decide whether a correction flow is needed before completion.
- [BUSINESS DECISION REQUIRED] R7 for missing parts: units inspected `DAMAGED` with condition `MISSING_PARTS` on a customer-caused return are treated like opened/used units (R7). Confirm.
- Note: DB Design §12 lists `resolution` / `RETURN_TO_CUSTOMER` on `return_items` and `return_inspections.result`. Implemented as a separate per-line decision (`return_items.customer_caused_resolution`), because a line can have several inspection outcomes (ADR-0060) and the decision comes after the assessment, not during inspection. `refund_eligible_amount` and `deduction_amount` are stored by TASK-041 at completion, when the amounts become final.
- Note: "manual exception workflow" (roadmap) is read as the human R7 resolution (Q97); alternative/manual refund methods stay future (Q16).

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
