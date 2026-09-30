# BeautyFits — Test Strategy v1.1

**Status:** Consolidated from existing source-of-truth documents (TASK-001)
**Sources:** `AGENTS.md`, `docs/tasks/implementation-roadmap.md` (§1, §5, TASK-006, TASK-062, TASK-063), `docs/product/user-flows.md` (§20), `docs/architecture/system-architecture.md`, `docs/database/database-design.md` (§23, §26), `docs/api/api-contract.md` (§34)

This document defines what must be tested and when. It introduces no business rules. Test tooling is recorded in `docs/decisions/ADR-0009-testing-foundation.md` (Vitest, selected in TASK-002); the remaining tooling is completed in TASK-006.

---

## 1. Current State

- TASK-002 established the unit-test foundation: Vitest, tests colocated as `src/**/*.test.ts`. There are no business tests yet.
- Until TASK-006 completes (CI, DB integration tests), the minimum checks for any change are:
  - `npm run lint`
  - `npm run typecheck` (`next typegen && tsc --noEmit`; plain `npx tsc --noEmit` fails on a clean checkout until Next.js route types are generated)
  - `npm test`
  - `npm run build` when application code changed
- Unit tests must not require a database.
- TASK-003 added PostgreSQL integration tests (`*.int.test.ts`, `npm run test:integration`, ADR-0010). Run them whenever database code, schema or migrations change.

## 2. Principles

1. Every task adds or updates automated tests for the behavior it changes (AGENTS.md; Roadmap §5).
2. Business rules are tested against the backend, which is authoritative; UI tests never substitute for backend enforcement tests.
3. Tests encode documented rules only. If a test needs a rule the documents do not define, mark `[BUSINESS DECISION REQUIRED]`.
4. Failed tests block merge (TASK-006).
5. CI must run on a clean checkout (TASK-006).

## 3. Test Levels

| Level | Purpose | Introduced |
|---|---|---|
| Unit | Pure domain logic: state-machine transition validation, money arithmetic in minor units, discount/shipping calculation, refund calculation, permission checks | TASK-006, then per feature task |
| Integration (with PostgreSQL) | Transactions, constraints, ledgers, idempotency, concurrency, migrations from a clean database | TASK-003 / TASK-006, then per feature task |
| API / contract | Endpoints match `docs/api/api-contract.md`: response shapes, stable error codes, authorization per endpoint, pagination | Per feature task |
| Concurrency & reliability | Races on stock, wallet, checkout, webhooks, refunds | TASK-062 (critical paths also covered in their own tasks) |
| End-to-end | High-value customer/admin flows from browse → checkout → delivery → return → refund | TASK-063 |
| Backup restore drill | Restore is verified, not assumed | TASK-064 |

## 4. Database Test Strategy

- A clean database must be creatable entirely from migrations (TASK-003).
- Integration tests run against real PostgreSQL, not a substitute engine, because correctness depends on PostgreSQL transactions and locking.
- Transaction boundaries must be testable (TASK-003); test that each atomic operation in DB Design §23 either fully commits or fully rolls back.
- Exact isolation/reset mechanism is chosen in TASK-006.

## 5. Critical Invariants — Must Have Automated Tests

From User Flows §20, DB Design §26, and API Contract §34:

| # | Invariant | Minimum tests |
|---|---|---|
| 1 | Backend is authoritative | Client-supplied price/total/discount/stock/permission values are ignored or rejected |
| 2 | No overselling | Concurrent checkouts for the last unit: exactly one succeeds |
| 3 | No duplicate orders | Repeated checkout with the same `Idempotency-Key` returns the original result; conflicting reuse → `IDEMPOTENCY_CONFLICT` |
| 4 | No partial checkout state | Failure at any step leaves no order, reservation, or wallet reservation |
| 5 | No historical destruction | Archived products/deactivated employees remain referenceable; order snapshots do not change when product/customer/address data changes |
| 6 | No wallet mutation without ledger entry | Every balance change has a matching `wallet_transactions` row; wallet double-spend under concurrency is prevented |
| 7 | No silent status jumps | Every invalid Order/Shipment/Return transition is rejected (e.g. `Preparing → Shipped` → `ORDER_STATE_INVALID`) |
| 8 | Return ≠ cancellation | Returned orders stay `Delivered`; returns have their own lifecycle |
| 9 | Shipping cancellation ≠ customer return | Shipping cancellation request does not change Order status; order becomes `Cancelled` only after the shipment is `Returned` and inspected |
| 10 | Marketing requires consent | No marketing recipient/fallback without per-channel consent |
| 11 | Return window ends at the end of the 14th calendar day after delivery, Africa/Cairo (Business Spec R21) | Boundary tests at the window edge, including DST transitions |
| 12 | External notifications are asynchronous | Notification/provider failure does not roll back a committed order |
| 13 | Manual money/stock changes require permission + audit | Missing permission → rejected; success writes audit log and reason |
| 14 | Inventory movements | Every stock change produces an inventory movement |
| 15 | Audit logs append-only | Application users cannot edit/delete audit rows |
| 16 | Money in minor units | No floating-point money; API monetary fields are integers |
| 17 | Global HALF-UP rounding (Business Spec R9) | Percentage discounts, tax, partial refunds (incl. 25% customer-caused refund), and WAC-derived amounts round HALF-UP to the nearest piastre, including exact `.5` piastre boundary cases |
| 18 | Cancellation window (Business Spec R11) | Direct cancellation succeeds from `Pending Confirmation`, `New`, `Confirmed`, `Preparing`, `Ready for Shipment`; from `Shipped` it becomes a shipping cancellation request and Order stays `Shipped` |
| 19 | Pending Confirmation → New is System-only (Business Spec R1, R10) | No staff endpoint performs the transition directly; phone confirmation records source `PHONE` + staff actor, then the System transitions |
| 20 | Wishlist reminders (Business Spec R6) | Every 3 days, max 3 per item; stop on purchase, removal, unavailable/archived, or lost channel consent |

## 6. Concurrency & Reliability Scenarios (TASK-062)

- Last-stock checkout race
- Duplicate checkout submission
- Wallet double-spend
- Duplicate webhook delivery
- Repeated refund request
- Concurrent edits (e.g. order modification vs staff transition)

## 7. Security Tests

Derived from `docs/security/security-requirements.md`:

- Authorization: every mutation endpoint rejects callers without the required permission; Managers cannot escalate permissions.
- OTP: expiry (5 min), resend cooldown (60 s), 5-attempt limit.
- Rate limiting on auth, OTP, checkout, review/report, and analytics endpoints.
- Guest order access cannot be obtained with an order number alone; guest claim requires OTP.
- Sensitive fields (cost, password hashes, OTP secrets) never appear in unauthorized responses.
- Webhook signature verification and idempotency.
- Upload validation rejects disallowed types/sizes and unscanned files are not published.
- Logs do not contain passwords, OTPs, or session tokens.

## 8. Per-Task Expectations

Each task file lists its own tests and edge cases (`docs/tasks/task-template.md`). A task is complete only when (Roadmap §5):

- Relevant automated tests exist and pass.
- Edge cases listed in the task are covered.
- Lint/typecheck/format pass.
- Relevant integration tests pass.

## 9. Tooling

Decided in TASK-002 (ADR-0009):
- Unit test framework: Vitest (`npm test`, `npm run test:watch`)
- `package.json` scripts `test`, `test:watch`, `typecheck`, `lint`

Decided in TASK-003 (ADR-0010):
- Integration tests against real PostgreSQL: `npm run test:integration`, separate config, test database named `*_test` recreated from migrations on every run, tables truncated between tests.

Deferred to TASK-006:
- Formatter choice
- CI provider/workflow and CI database provisioning
