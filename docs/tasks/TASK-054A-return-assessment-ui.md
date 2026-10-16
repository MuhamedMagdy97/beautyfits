# TASK-054A — Return Assessment, R7 Decision & Refund Preview Screens

## Goal
Staff finish an inspected return from the dashboard: record the final responsibility, decide customer-caused damaged units (R7), see the refund before completing it, then complete it with the TASK-041 card. No raw API calls are needed.

## Dependencies
TASK-040 (assessment, resolution, refund calculation API), TASK-041 (completion and wallet refund, completion card), TASK-054 (return detail screen).

## Source of Truth
- Business Spec Q29, Q96–Q99, C2, C3, R7
- User Flows §11.5–§11.6
- API Contract "TASK-040 Amendments", "TASK-041 Amendments"
- `docs/security/permission-catalog.md` (`COMPLETE_RETURN`, `RESOLVE_CUSTOMER_CAUSED_RETURN`, `RETURNS_VIEW`)
- Design reference: no dashboard screen exists in `design-reference/google-stitch/`; cards follow the existing return screen (ADR-0063).
- ADR-0063, ADR-0066, ADR-0068

## Scope
On `/staff/returns/[returnId]`, while the return is `INSPECTING`:
- **Assess responsibility** card, once every line is inspected and no assessment exists (`COMPLETE_RETURN`): responsible party (Customer / BeautyFits / Carrier, no default), optional return shipping fee typed in EGP and sent in piastres, optional notes; confirm before sending (recorded once). `POST /admin/returns/{id}/assessment`.
- **R7 decision** per line, when the assessment is `CUSTOMER`, the line has `DAMAGED` units and no decision yet (`RESOLVE_CUSTOMER_CAUSED_RETURN`): optional notes and two buttons, "Send back to customer, no refund" (`RETURN_TO_CUSTOMER`) and "Keep and refund partially" (`KEEP_PARTIAL_REFUND`); confirm before sending. `POST /admin/return-items/{id}/resolution`.
- **Refund preview** (`GET /admin/returns/{id}/refund`, `RETURNS_VIEW`) above the completion card: what is still missing or "ready", product, delivery fee and total amounts when ready, the pickup fee payer after assessment and whether it differs from the payer at pickup. Refetched whenever the return changes.
- The recorded assessment (party, fee, notes, date) in the summary; each line's R7 decision under its inspection.
- Arabic and English texts; localized refusals for `RETURN_ALREADY_ASSESSED`, `INSPECTION_INCOMPLETE`, `RESPONSIBILITY_NOT_CUSTOMER`, `NO_CUSTOMER_CAUSED_UNITS`, `RETURN_ITEM_ALREADY_RESOLVED`.

## Non-Goals
- API, database or business-rule changes.
- Changing a recorded assessment or decision (the API records each once).
- Settling a pickup fee payer change (not decided, ADR-0066; only shown).
- Showing the configured R7 partial-refund rate before the decision (the preview shows the result afterwards).

## Files / Modules
- `src/app/staff/(shell)/returns/[returnId]/page.tsx`
- `src/app/staff/_lib/{orders.ts,orders-i18n.ts,orders.test.ts}`
- `docs/tasks/implementation-roadmap.md`

## Business Rules
None new. The API decides; the screen offers the step only when the API would accept it (ADR-0063) and shows its refusal otherwise.

## API Changes
None.

## Database Changes
None.

## Security / Authorization
- Cards are hidden without their permission (cosmetic); the API authorizes every call.
- The fee is parsed as integer piastres without floating point (`parsePounds`); the API validates the range.
- Type-only imports of server code.

## Acceptance Criteria
- An Owner can take a return from `INSPECTING` (all lines inspected) through assessment, R7 decisions and completion, entirely in the dashboard.
- The assessment card appears only after every line is inspected and disappears once recorded.
- R7 buttons appear only for damaged lines of customer-caused returns without a decision.
- The refund preview reflects each step (assessment required → resolution required → ready with amounts).
- All required checks pass.

## Tests
- Unit `src/app/staff/_lib/orders.test.ts`: `allInspected`, `needsResolution` (responsibility, damaged units, existing decision, uninspected line); Arabic/English key parity covers the new texts.
- The endpoints are covered by the TASK-040/041 route integration tests.
- Manual: browser walk-through of the full flow as Owner.

## Edge Cases
- Invalid fee text (letters, more than two decimals): refused on the screen before sending.
- A second tab already assessed / decided: the API refusal is shown localized; reload shows the recorded value.
- Customer-caused return with no damaged units: no R7 step; the preview goes straight to ready.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- The assessment uses `COMPLETE_RETURN` until the owner decides who assesses (ADR-0066); the card follows the API.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [x] Reviewed
- [x] Done
