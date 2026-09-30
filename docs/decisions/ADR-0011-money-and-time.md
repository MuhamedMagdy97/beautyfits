# ADR-0011 — Money and time helpers

- **Status:** Accepted (TASK-005)
- **Date:** 2026-09-30
- **Relates to:** ADR-0003; Business Spec R5, R9, R20–R22; Database Design §1 principles 3 and 10; Architecture §7; API Contract §2 principle 3; Test Strategy rows 11, 16, 17

## Context

Money must be exact integer minor units (EGP piastres) with one global HALF-UP rounding policy, applied in one shared backend helper (Architecture §7). Timestamps are stored in UTC, but some rules count calendar days in the business timezone (R20, R21). Both helpers are needed before any pricing, discount, refund, return or analytics code is written.

## Decision

### Money (`src/server/money/money.ts`)

- Amounts are `bigint` minor units (`MinorUnits`), matching Prisma `BigInt` money columns. `number` is accepted only at the edges and only as a safe integer (`toMinor`, `minorUnitsSchema`); a fractional value throws.
- The only currency is EGP (`CURRENCY`). Money columns store the currency next to the amount. Mixing currencies is not possible because there is only one; multi-currency support would need a new ADR.
- Derived amounts are exact fractions rounded once by `roundHalfUp(numerator, denominator)`. Ties round away from zero (`2.5 → 3`, `-2.5 → -3`; R9, R22). `multiplyRatio`, `percentOf` (decimal string such as `"12.5"`, never a float) and `basisPointsOf` build on it. Callers compute the whole expression first and round at the end, never at intermediate steps.
- `parseMajor("199.99")` converts admin-entered major units strictly (at most two decimals, no rounding). `formatMajor` renders a plain `199.99` string for exports and logs. Localized display (Arabic/English digits, currency symbols) belongs to the clients.
- `toJsonNumber` converts to a JSON number and throws above `Number.MAX_SAFE_INTEGER` (about 90 trillion EGP), so API values are always exact.
- Out of scope: splitting an amount across lines (for example an order-level discount). The remainder rule is a business decision for the discount/checkout tasks.

### Time (`src/server/time/time.ts`)

- Instants are `Date` values, serialized with `toIsoUtc` (ISO-8601, `Z`). `parseTimestamp` accepts only `YYYY-MM-DDTHH:mm[:ss[.fff]]` followed by `Z` or `±HH:mm`. Fractional seconds are limited to 3 digits (milliseconds), which is the precision of `Date`, of `toIsoUtc` output and of the `timestamptz(3)` columns. More digits are rejected rather than silently truncated. Offsets must be between `-12:00` and `+14:00`. Impossible dates and times that `Date` would silently roll over (`02-30`, `24:00`) are rejected.
- Services receive a `Clock` (`systemClock`, `fixedClock` for tests) instead of calling `new Date()` directly when the current time affects a business result.
- Exact durations (for example the 72-hour COD confirmation maximum, R21) use millisecond arithmetic on instants, so DST does not affect them. `addMilliseconds` takes whole milliseconds and `addHours` takes whole hours; NaN, Infinity, fractions and results outside the `Date` range throw. Finer durations use `addMilliseconds` with `MS_PER_MINUTE`/`MS_PER_SECOND`.
- Calendar days use `BUSINESS_TIME_ZONE = "Africa/Cairo"` (R20) through the built-in `Intl` API and the runtime's timezone database. No dependency is added.
  - `localDateOf`, `addCalendarDays`, `startOfLocalDay` and `localDaysRange` produce half-open UTC ranges `[start, end)` for analytics days and custom ranges. The meaning of the 7D/30D/90D presets is left to the analytics task.
  - `startOfLocalDay` handles Egypt's DST: when the clocks jump from 00:00 to 01:00 the day starts at 01:00, and when 23:00–24:00 repeats the day is 25 hours long.
  - `calendarDayDeadline(from, days)` returns the exclusive end of "until the end of the Nth calendar day after the local date of `from`, where that date is day 0". The return window (R21) is `calendarDayDeadline(deliveredAt, 14)`.

## Consequences

- Money and date logic has one tested implementation. New code must not round money or compute business days by hand.
- The server's timezone setting (`TZ`) does not matter; all zone logic is explicit.
- Correct Cairo DST depends on the ICU/tz data shipped with Node.js. If Egypt changes its DST rules, upgrading Node.js picks up the change. The DST tests pin the 2026 transitions and will flag an outdated runtime.
