# TASK-005 — Cross-Cutting Backend Foundations (remaining scope)

## Goal
Complete the remaining TASK-005 scope listed in `docs/tasks/implementation-roadmap.md` ("Status after TASK-002"): money helpers, time handling helpers, the v1.2 error codes `UNAUTHENTICATED` and `RATE_LIMITED`, and redaction of secrets inside logged error messages.

## Dependencies
- TASK-002 (merged): error model, request ids, logger, validation, response conventions, config validation.
- TASK-002A (merged): API contract v1.2 error codes.
- TASK-003 (merged): database, transaction helper, integration tests. This task is rebased on it; nothing here touches the database.

## Source of Truth
- `docs/product/business-spec.md` R5 (money representation), R9 (HALF-UP rounding), R20–R22 (this task's owner decisions).
- `docs/database/database-design.md` §1 principles 3 (money) and 10 (UTC timestamps).
- `docs/architecture/system-architecture.md` §7 (one shared backend money helper).
- `docs/api/api-contract.md` §2 principle 3, §6.1 (error conventions), §29 (error codes).
- `docs/security/security-requirements.md` §9; `docs/decisions/ADR-0003`, `ADR-0006`.
- `docs/testing/test-strategy.md` rows 16 and 17.

## Scope
1. **Money helpers** (`src/server/money/`): integer minor units (EGP piastres) as `bigint`; exact arithmetic; exact rational multiplication (percentages, rates, ratios) with a single HALF-UP rounding step; strict parsing of major-unit decimal strings; safe conversion to a JSON integer for API payloads.
2. **Time helpers** (`src/server/time/`): injectable clock, UTC ISO-8601 serialization, strict parsing of timestamps that carry an explicit offset, exact duration arithmetic on UTC instants, and Africa/Cairo calendar-day boundaries, ranges and calendar-day deadlines (R20, R21).
3. **Error codes**: add `UNAUTHENTICATED` (401) and `RATE_LIMITED` (429) to `src/server/errors/app-error.ts`.
4. **Logger**: redact secrets found inside error messages and stacks (not only sensitive keys).

## Non-Goals
- No database schema, migrations or Prisma changes.
- No multi-currency support (EGP only), no currency conversion.
- No allocation/splitting of an amount across order lines (the split rule is a business decision for the checkout/discount tasks).
- No rate limiter implementation and no authentication (TASK-007+); only the error codes.
- No display formatting for the Website/Dashboard (Arabic/English number formatting belongs to the clients).
- No return-window, COD-expiry or analytics-preset business logic: the modules that own those rules (returns, orders, analytics) use these helpers later.
- No new dependencies.

## Files / Modules
- `src/server/money/money.ts`, `money.test.ts`
- `src/server/time/time.ts`, `time.test.ts`
- `src/server/errors/app-error.ts`, `app-error.test.ts`
- `src/server/logging/logger.ts`, `logger.test.ts`
- `src/server/README.md` (module table)
- `docs/decisions/ADR-0011-money-and-time.md` (new) and `docs/decisions/README.md`; `docs/decisions/ADR-0006-logging.md` (redaction update); `docs/tasks/implementation-roadmap.md` (TASK-005 status)
- `docs/product/business-spec.md` (R20–R22) and `docs/decisions/business-rules-ledger.xlsx` ("Closure & Audit Decisions" rows R20–R22)
- Wording aligned with R20/R21 in `docs/product/user-flows.md`, `docs/architecture/system-architecture.md`, `docs/database/database-design.md`, `docs/api/api-contract.md`, `docs/testing/test-strategy.md`

## Business Rules
- R5: money is integer minor units; floating point is never used for money.
- R9: derived amounts use exact arithmetic; the final result is rounded once to the nearest piastre, HALF-UP.
- DB §1.10: timestamps are stored in UTC; presentation timezone is handled by the application.
- R20: business timezone is Africa/Cairo, including DST; calendar-day concepts use it.
- R21: the return window lasts until the end of the 14th calendar day after the Cairo delivery date (delivery day = day 0); the COD confirmation maximum is an exact 72 hours elapsed from order creation.
- R22: HALF-UP ties round away from zero for negative amounts (`-2.5 → -3`).

## API Changes
None to behavior. The two error codes are already in API contract §6.1/§29 (v1.2); this task makes the code match.

## Database Changes
None.

## Security / Authorization
- Logs must not contain secrets that appear inside error messages (for example a database URL with a password, a Bearer token, or `password=...`).
- Money helpers reject non-integer, unsafe or out-of-range values so a client cannot inject a fractional or float amount.

## Acceptance Criteria
- Money cannot be represented inconsistently: helpers only accept integer minor units; no `number` float path exists for arithmetic.
- HALF-UP rounding is implemented once and covered at exact `.5` piastre boundaries (test strategy row 17).
- `UNAUTHENTICATED` → 401 and `RATE_LIMITED` → 429, matching API contract §6.1.
- A secret inside a logged `Error` message/stack (and nested `cause`) is replaced with `[REDACTED]`.
- Lint, typecheck, unit tests and build pass.

## Tests
- Money: add/subtract/sum, rational multiply with HALF-UP (positive, negative, `.5` boundaries), percentage and basis-point helpers, 25% of odd amounts (R7 example), parse/serialize round-trips, rejection of floats/NaN/unsafe values.
- Time: ISO UTC serialization, offset-required and impossible-date parsing, exact 72 h across DST, clock injection, Cairo day boundaries including both 2026 DST transitions, analytics day ranges, R21 return-window deadline boundaries.
- Errors: status map covers the new codes.
- Logger: Bearer tokens, URL credentials, `key=value` secrets in messages, stacks and causes are redacted; normal messages are unchanged.

## Edge Cases
- Negative amounts (adjustments, reversals) with HALF-UP at `-x.5`.
- Division by zero / zero denominator in ratios.
- Values above `Number.MAX_SAFE_INTEGER` when serializing to JSON.
- Timestamps without an offset (ambiguous) are rejected.
- DST transitions in Africa/Cairo: 2026-04-24 has no local midnight (00:00 → 01:00); 2026-10-29 repeats 23:00–24:00.

## Owner Decisions (recorded 2026-09-30)
Resolved by the product owner and recorded as Business Spec R20–R22 and in the ledger ("Closure & Audit Decisions"). No open decisions remain for this task.

## Plan
1. Add `UNAUTHENTICATED` (401) and `RATE_LIMITED` (429) to `app-error.ts`, with tests.
2. Money helpers as `bigint` minor units, a single `roundHalfUp` (ties away from zero), ratio/percent/basis-point helpers, strict major-unit parsing, safe JSON conversion, a zod input schema.
3. Time helpers: `Clock`, UTC serialization and strict parsing, exact durations, Africa/Cairo calendar days via `Intl` (no new dependency), `calendarDayDeadline` for R21.
4. Logger: mask secrets inside every logged string (msg, error message/stack, causes).
5. ADR-0011, ADR-0006 update, business spec R20–R22 and ledger, doc wording alignment, roadmap status.
6. Run lint, typecheck, unit tests, integration tests and build; commit, push, open a PR (not merged).

## Definition of Done
- Acceptance criteria satisfied, tests and required checks pass, docs updated, committed on `feature/TASK-005-cross-cutting-foundations`, PR opened (not merged).

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
