# ADR-0066 — Refund Calculation and Resolution Rules

- **Status:** Accepted (TASK-040)
- **Date:** 2026-10-17
- **Relates to:** ADR-0035 (discount per line), ADR-0034 (wallet), ADR-0056 (pickup fee payer), ADR-0060 (inspection outcomes), ADR-0054 (critical settings); Business Spec Q16, Q29, Q96–Q99, Q180, C2, C3, R7, R9, R18; User Flows §11.5–§11.6; API §17 and "TASK-040 Amendments"; DB Design §12 and "v1.2 TASK-040 Amendments"

## 1. Assessment

Q99 separates the customer's reason from the final assessed responsibility. `POST /admin/returns/{id}/assessment` records it once, after every line is inspected, on `returns.final_responsibility` (`CUSTOMER` | `BEAUTYFITS` | `CARRIER`; `UNDETERMINED` until then), with who, when, optional notes and the pickup fee the carrier charged (`return_shipping_fee`, recorded only). It is gated by `COMPLETE_RETURN` because it decides the refund (R18); who should assess is an open item.

## 2. R7 decision per line

When the customer is responsible, a line's `DAMAGED` units are the R7 exception (Q97: human-resolved). `POST /admin/return-items/{id}/resolution` (`RESOLVE_CUSTOMER_CAUSED_RETURN`) records `RETURN_TO_CUSTOMER` (no refund) or `KEEP_PARTIAL_REFUND` once per line, with the rate in force (`resolution_basis_points`). It is a column on `return_items`, not a new inspection result: a line can have several outcomes (ADR-0060) and the decision follows the assessment. The audit entry holds the decision, the rate, the refund and the deduction.

## 3. Calculation

`calculateRefund` (pure) and `loadReturnRefund` (reads the return) give each line's paid amount, outcome quantities, refund and deduction, and the return's product refund, delivery fee refund and total, with a status (`INSPECTION_REQUIRED`, `ASSESSMENT_REQUIRED`, `RESOLUTION_REQUIRED`, `READY`); amounts are null until `READY`.

- Paid amount of `k` units after `p` earlier returned units of the line: `round(T·(p+k)/q) − round(T·p/q)`, HALF-UP (R9), where `T` is the line total (net of the discount share, ADR-0035) and `q` the ordered quantity. The returns of one line sum to at most `T`.
- The paid amount is split over restocked, damaged and rejected units with `allocate`. Restocked: full. Rejected: nothing. Damaged: full for BeautyFits / carrier, else R7 (`basisPointsOf`, HALF-UP; the rest is the deduction).
- Delivery fee (C3): the order's `shipping_fee` when BeautyFits or the carrier is responsible, for the first such return assessed on the order only.
- Pickup fee (C2): final payer `CUSTOMER` for customer-caused returns, `BEAUTYFITS` otherwise; reported with the provisional payer and `payerChanged`. No settlement is added to the total (open item).

## 4. Policy rate

The 25% is the critical setting `returns.customer_caused_refund_basis_points` (default 2500, 1–10000), changed only through the Owner/Admin approval of TASK-057 (Q180, Q181).

## Consequences

- TASK-041 locks the return, calls `loadReturnRefund`, requires `READY`, credits `totalRefund` to the wallet and stores `refund_eligible_amount`, `deduction_amount` and `refund_total` with the completion.
- Amounts are not stored before completion; a later rejection of an earlier return of the same line can move an unfinished return's share by one piastre.
- Open items (task file): who assesses, pickup fee settlement, delivery fee proration, rejected units, per-unit R7 split, corrections.
