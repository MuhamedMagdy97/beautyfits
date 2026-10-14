# TASK-035 — Delivery Failure & Attempts

## Goal

Staff record failed delivery attempts on a shipment; BeautyFits counts them and, after the configured threshold, creates a customer-contact task that staff work and close. The order stays `SHIPPED`.

## Dependencies

TASK-034 (shipments, ADR-0040), TASK-004 (settings, ADR-0017).

## Source of Truth

- Business Spec Q19, Q127, Q128, Q129, R2
- User Flows §8.2, §8.3, §10
- Architecture §13 (attempts, delivery events)
- DB Design §9, "Shipping follow-up" (`customer_contact_tasks`)
- API Contract §16 (`status` with `DELIVERY_FAILED`, `/admin/contact-tasks`)
- Permission catalog (`MANAGE_SHIPMENT`, `CONTACT_TASK_MANAGE`)

## Scope

- Shipment edges `OUT_FOR_DELIVERY → DELIVERY_FAILED → OUT_FOR_DELIVERY`; `shipments.attempt_count`; `DELIVERY_FAILED` shipment event.
- `customer_contact_tasks`; threshold setting; task creation at the threshold.
- `GET /admin/contact-tasks`, `PATCH /admin/contact-tasks/{taskId}`; audit entries.

## Non-Goals

- Return to sender / returned / shipping cancellation (TASK-036); carrier webhooks and carrier-specific attempt policies; notifications to the customer about a failure; contact tasks for reasons other than failed deliveries; UI (dashboard tasks later).

## Files / Modules

- `src/server/modules/shipping/shipments.ts`, `shipments-service.ts`, `contact-tasks-service.ts`, `schemas.ts`, `shipments.test.ts`
- `src/server/modules/settings/settings.ts`, `src/server/modules/audit/audit.ts`
- `src/app/api/v1/admin/contact-tasks/route.ts`, `src/app/api/v1/admin/contact-tasks/[taskId]/route.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261014035000_delivery_failures/`
- Docs: ADR-0047, API / DB "TASK-035 Amendments", roadmap

## Business Rules

- Q128: a failure is `Delivery Failed` on the shipment; never a cancellation.
- Q19, Q129, User Flows §10: carrier attempts continue; BeautyFits tracks attempts and failures; after a configurable threshold a customer-contact task is created.
- R2: shipment state is separate; the order stays `SHIPPED`.
- Q127: the customer timeline shows `Delivery Failed` (from shipment events).

## API Changes

API Contract "TASK-035 Amendments".

## Database Changes

Migration `20261014035000_delivery_failures`; DB Design "v1.2 TASK-035 Amendments".

## Security / Authorization

`DELIVERY_FAILED` needs `MANAGE_SHIPMENT`; tasks need `CONTACT_TASK_MANAGE`. The order, then the shipment, then (for task updates) the task row are locked; the threshold check runs under the shipment lock. Tasks carry no customer contact data. All changes audited; logs carry ids only. Customers see failure events without notes or locations.

## Acceptance Criteria

- `DELIVERY_FAILED` only from `OUT_FOR_DELIVERY`; another attempt goes back to `OUT_FOR_DELIVERY`; delivery still possible afterwards.
- Each failure adds one to `attemptCount` and writes an event; the order stays `SHIPPED`.
- At the threshold (setting, provisional 2) exactly one unfinished task exists per shipment; a closed task lets the next failure open a new one.
- Tasks can be assigned to active employees, get outcome notes, and be resolved/cancelled (final); never deleted.
- All required checks pass.

## Tests

- Integration `src/app/api/v1/admin/shipments/shipments-routes.int.test.ts` ("delivery failures and contact tasks"): attempts, threshold (default and configured), single active task, task workflow, closed-task refusal, validation, permissions, customer tracking, audit, no-delete trigger.
- Unit `src/server/modules/shipping/shipments.test.ts` (graph), `src/server/modules/bootstrap/bootstrap.test.ts` (setting default).

## Edge Cases

- A failure while a task is open: count increases, no second task.
- An invalid stored threshold falls back to the default (logged).
- Delivery after failures leaves any open task for staff to close (no automatic closing rule exists).

## Definition of Done

Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items

- [BUSINESS DECISION REQUIRED] Contact threshold: after how many failed attempts is a customer-contact task created (Q19, Q129 say "configurable" without a value)? Implemented as setting `shipping.delivery_failure_contact_threshold` with a provisional default of 2.
- [BUSINESS DECISION REQUIRED] Repeat tasks: after a task is closed and deliveries keep failing, should each further failure open a new task (implemented), or only one task per shipment ever?
- [BUSINESS DECISION REQUIRED] Should a task close automatically when the shipment is delivered or returned? Not implemented; staff close it.
- [BUSINESS DECISION REQUIRED] Should the customer be notified of a failed attempt (WhatsApp/email)? No notification yet.

## Status

- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
