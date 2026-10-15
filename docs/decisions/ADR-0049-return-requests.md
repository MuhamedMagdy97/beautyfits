# ADR-0049 — Customer Return Requests

- **Status:** Accepted (TASK-037)
- **Date:** 2026-10-14
- **Relates to:** ADR-0021 (uploads), ADR-0036 (order core), ADR-0040 (`delivered_at`), ADR-0018 (audit logs), ADR-0011 (time); Business Spec Q5, Q14, Q17, Q34, Q90–Q92, Q99, Q100, R20, R21, R34; User Flows §11; Architecture §14; API §17, §28 and "TASK-037 Amendments"; DB Design §12 and "v1.2 TASK-037 Amendments"

## 1. A separate aggregate; the order is not touched

A return is its own row with its own `return_status` enum (DB Design §12 values, all created now so TASK-038–041 add transitions, not migrations). Creating, withdrawing or rejecting a return never changes `orders.status`: the order stays `DELIVERED` (Q90), and the shipment is untouched. TASK-037 only moves `→ PENDING_APPROVAL` (create) and `PENDING_APPROVAL → CANCELLED` (customer withdraws). Status history for staff transitions is added with them (TASK-038); until then the audit log records each change.

## 2. Window and quantities are checked under the order lock

Creating a return locks the order row (`FOR UPDATE`), then checks: the order belongs to the signed-in customer (otherwise `404`), is `DELIVERED` with `delivered_at`, and `now < calendarDayDeadline(delivered_at, 14)` (R21: end of the 14th Cairo calendar day; `14` is a constant because Q17 makes it final). Each order line may be requested up to its ordered quantity minus the quantities of the order's other returns that are not `REJECTED` or `CANCELLED`. The lock serializes concurrent requests, so two requests can never claim the same units. No `Idempotency-Key`: a retried request can at most ask for the remaining units, which the quantity check bounds; the API contract does not require one for this endpoint.

## 3. Claim type decides whether photos are required

Q14 makes the free-text reason the customer's own words and Q100 requires photos "for damage/wrong-item cases". The request therefore carries a `claimType` (`DAMAGED`, `WRONG_ITEM`, `OTHER`) chosen by the customer; `DAMAGED` and `WRONG_ITEM` need at least one photo. It is the customer's claim only: the final assessed reason and responsibility are recorded separately after inspection (Q99, TASK-039/040). Owner decision 2026-10-15: the categories are `DAMAGED`, `WRONG_ITEM`, `DEFECTIVE`, `EXPIRED`, `MISSING_ITEM` and `OTHER` (change of mind). Photos are required for `DAMAGED`, `WRONG_ITEM`, `DEFECTIVE` and `EXPIRED` (Q100; owner decision 2026-10-15); a missing item cannot be photographed. On a change of mind, free gifts (zero-price lines) cannot be requested and opened units must be rejected at inspection; every other claim may return both.

## 4. Customers upload evidence through the one upload flow

API §28 allows customer uploads for their returns. Media purpose `RETURN_EVIDENCE` is uploaded by customers only (staff sessions are refused for it, customers are refused for every other purpose) with the same file checks as other images. `media_assets.created_by_customer_id` records the uploader (check: never both creators); only that customer can complete the upload and attach it. Photos are attached at creation (`evidenceMediaAssetIds`) or later while `PENDING_APPROVAL` (`POST /returns/{id}/evidence`); a photo belongs to at most one return (unique `media_asset_id`), and a return holds at most 10 photos (technical limit). Customer uploads are rate limited to 30 starts per customer per hour. `/files/upload-init` picks the session kind from the declared purpose; `/files/complete` from the stored file's purpose. Staff with `RETURNS_VIEW` can download evidence through `GET /files/{id}/content`; customers do not download it yet (they have the original), see the task's open items.

## 5. History is kept

Returns and return items are never deleted (triggers); evidence rows are append-only. A rejected return is never rewritten: `resubmit` creates a new return linked by `resubmitted_from_return_id` (Q92), with all checks applied again (the window included). Audit actions `RETURN_REQUESTED`, `RETURN_EVIDENCE_ADDED`, `RETURN_CANCELLED` (actor: the customer).

## 6. Deactivation

R34: a return in `PENDING_APPROVAL`, `APPROVED`, `PICKUP_SCHEDULED`, `RECEIVED`, `INSPECTING` or `PARTIALLY_COMPLETED` blocks account deactivation (`openItems` gains `OPEN_RETURN`).

## Consequences

- TASK-038 adds approve/reject/pickup transitions and status history; TASK-039–041 add the inspection and refund columns to `returns` / `return_items` (they are not created now; `return_items` rows may be updated by those tasks, only deletes are blocked).
- Guest orders cannot be returned through the API (customer endpoints need an account); see open items.
- Analytics does not copy return requests (ADR-0044 §1); no notification is sent for a new request (§31 lists none).
