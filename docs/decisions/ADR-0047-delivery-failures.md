# ADR-0047 — Delivery Failures, Attempts and Customer-Contact Tasks

- **Status:** Accepted (TASK-035)
- **Date:** 2026-10-14
- **Relates to:** ADR-0040 (shipments), ADR-0017 (settings); Business Spec Q19, Q127, Q128, Q129, R2; User Flows §8.2, §10; API §16 and "TASK-035 Amendments"; DB Design §9, "Shipping follow-up" and "v1.2 TASK-035 Amendments"

## 1. Shipment edges

`SHIPMENT_TRANSITIONS` gains `OUT_FOR_DELIVERY → DELIVERY_FAILED` and `DELIVERY_FAILED → OUT_FOR_DELIVERY` (another attempt, User Flows §10). A failure is recorded through the existing manual endpoint `POST /admin/shipments/{id}/status` (`MANAGE_SHIPMENT`) with a `DELIVERY_FAILED` shipment event (notes/location optional, staff only). The order stays `SHIPPED` (R2, Q128: one failed attempt never cancels). `DELIVERY_FAILED → RETURN_TO_SENDER` comes with TASK-036.

## 2. Attempts

`shipments.attempt_count` counts **failed** delivery attempts: each `DELIVERY_FAILED` adds one, in the same transaction as the status change (the shipment row is locked). The event history keeps every attempt and failure with its time (Q129 "tracked").

## 3. Customer-contact tasks

`customer_contact_tasks` follows DB Design "Shipping follow-up". When a failure brings `attempt_count` to the threshold or beyond and the shipment has no unfinished (`OPEN`/`IN_PROGRESS`) `DELIVERY_FAILED_THRESHOLD` task, one is created in the same transaction, audited `CONTACT_TASK_CREATED` with the System actor. A partial unique index keeps at most one unfinished threshold task per shipment; after a task is closed, the next failure at or above the threshold opens a new one.

The threshold is the setting `shipping.delivery_failure_contact_threshold` (Q19, Q129 "configurable"; DB Design: "a setting"). The documents give no value; the owner decided on **2** (2026-10-15). Changing it needs no code change (settings screen TASK-057).

`GET /admin/contact-tasks` and `PATCH /admin/contact-tasks/{id}` (`CONTACT_TASK_MANAGE`) list tasks (oldest first; filters status, order, assignee) and assign (active employee), record outcome notes and move `OPEN → IN_PROGRESS → RESOLVED | CANCELLED`. Closed tasks are final (`409 CONFLICT`, `CONTACT_TASK_CLOSED`); closing records `resolved_at` and the employee. Every change is audited `CONTACT_TASK_UPDATED`. Tasks are never deleted (trigger). Tasks do not carry customer contact data; staff open the order (contact masking stays with `VIEW_CUSTOMER_CONTACT`).

## Consequences

- Migration `20261014035000_delivery_failures`: enum value `shipment_event_type.DELIVERY_FAILED`, `shipments.attempt_count`, table `customer_contact_tasks` with checks, partial unique index and no-delete trigger. No new dependency.
- No outbox event or notification for failures yet (TASK-045 templates cover shipped/delivered only); carrier webhooks map to the same edges later.
