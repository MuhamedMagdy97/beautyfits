/**
 * Time helpers (ADR-0011; Database Design §1 principle 10; Business Spec R20, R21).
 *
 * Instants are `Date` values and are stored and transported in UTC
 * (ISO-8601 with `Z`). Calendar-day concepts (analytics Today/Yesterday,
 * the return window) are evaluated in the business timezone, Africa/Cairo,
 * including daylight saving time. Exact durations (for example the 72-hour
 * COD confirmation maximum) are plain millisecond arithmetic on instants.
 */

/** Business timezone (Business Spec R20). */
export const BUSINESS_TIME_ZONE = "Africa/Cairo";

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Source of the current time. Services take a `Clock` so tests can fix "now". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(instant: Date | string): Clock {
  const ms = (typeof instant === "string" ? parseTimestamp(instant) : instant).getTime();
  return { now: () => new Date(ms) };
}

function assertValid(instant: Date): void {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Invalid date");
  }
}

/** ISO-8601 UTC string, e.g. `2026-09-30T12:00:00.000Z`. */
export function toIsoUtc(instant: Date): string {
  assertValid(instant);
  return instant.toISOString();
}

/**
 * Strict ISO-8601 / RFC 3339 timestamp accepted by `parseTimestamp`:
 * `YYYY-MM-DDTHH:mm[:ss[.fff]]` followed by `Z` or `±HH:mm`.
 * - Fractional seconds: at most 3 digits (milliseconds). This is the precision
 *   of `Date`, of `toIsoUtc` output and of the `timestamptz(3)` columns; more
 *   digits are rejected instead of being silently truncated.
 * - Offset: from `-12:00` to `+14:00` inclusive (the range of real UTC offsets).
 */
const ISO_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const MAX_OFFSET_EAST_MINUTES = 14 * 60;
const MAX_OFFSET_WEST_MINUTES = 12 * 60;

function isValidOffset(sign: string | undefined, hours: string, minutes: string): boolean {
  if (sign === undefined) {
    return true; // `Z`
  }
  if (Number(minutes) > 59) {
    return false;
  }
  const total = Number(hours) * 60 + Number(minutes);
  return total <= (sign === "+" ? MAX_OFFSET_EAST_MINUTES : MAX_OFFSET_WEST_MINUTES);
}

/**
 * Parses a timestamp in the format above. Timestamps without an offset are
 * ambiguous and rejected, and so are impossible dates/times such as `02-30`
 * or `24:00`, which `Date` would otherwise silently roll over.
 */
export function parseTimestamp(value: string): Date {
  const match = ISO_TIMESTAMP.exec(value);
  const [, date, hour, minute, second = "0", sign, offsetHour = "0", offsetMinute = "0"] =
    match ?? [];
  if (
    !match ||
    !isLocalDate(date) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    !isValidOffset(sign, offsetHour, offsetMinute)
  ) {
    throw new RangeError(
      `Invalid timestamp "${value}": ISO-8601 with an offset and at most millisecond precision is required`,
    );
  }
  const instant = new Date(value);
  assertValid(instant);
  return instant;
}

/**
 * Adds an exact duration in whole milliseconds (negative to subtract).
 * NaN, Infinity and fractional values are rejected: `Date` would otherwise
 * produce an invalid date or silently truncate the fraction.
 */
export function addMilliseconds(instant: Date, ms: number): Date {
  assertValid(instant);
  if (!Number.isSafeInteger(ms)) {
    throw new RangeError(`Duration must be a whole number of milliseconds, got ${ms}`);
  }
  const result = new Date(instant.getTime() + ms);
  assertValid(result);
  return result;
}

/**
 * Adds an exact duration in whole hours (negative to subtract), e.g. the
 * 72-hour COD confirmation maximum (R21). Use `addMilliseconds` with
 * `MS_PER_MINUTE`/`MS_PER_SECOND` for finer durations; fractional hours are
 * rejected so no floating-point rounding can creep into a deadline.
 */
export function addHours(instant: Date, hours: number): Date {
  if (!Number.isSafeInteger(hours)) {
    throw new RangeError(`hours must be a whole number, got ${hours}`);
  }
  return addMilliseconds(instant, hours * MS_PER_HOUR);
}

// ---------------------------------------------------------------------------
// Calendar days in a timezone

/** A calendar date without a time or zone, `YYYY-MM-DD`. */
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: string): value is LocalDate {
  const match = LOCAL_DATE.exec(value);
  if (!match) {
    return false;
  }
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseLocalDate(value: LocalDate): [number, number, number] {
  if (!isLocalDate(value)) {
    throw new RangeError(`Invalid local date "${value}"`);
  }
  const [y, m, d] = value.split("-").map(Number);
  return [y, m, d];
}

function formatLocalDate(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of `instant` in `timeZone`. */
function wallClock(instant: Date, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (Cairo: +2 h or +3 h). */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  assertValid(instant);
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / MS_PER_SECOND) * MS_PER_SECOND;
}

/** The calendar date of `instant` in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): LocalDate {
  assertValid(instant);
  const w = wallClock(instant, timeZone);
  return formatLocalDate(w.year, w.month, w.day);
}

/** Adds calendar days to a local date (no timezone involved). */
export function addCalendarDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) {
    throw new RangeError(`days must be an integer, got ${days}`);
  }
  const [y, m, d] = parseLocalDate(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return formatLocalDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * First instant of `date` in `timeZone`. Usually local midnight; when a DST
 * change skips midnight (Egypt moves 00:00 → 01:00), it is the first instant
 * that exists on that date.
 */
export function startOfLocalDay(date: LocalDate, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const [y, m, d] = parseLocalDate(date);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  // Try the offsets in force just before and just after local midnight.
  const candidates = [
    midnightAsUtc - timeZoneOffsetMs(new Date(midnightAsUtc - MS_PER_DAY), timeZone),
    midnightAsUtc - timeZoneOffsetMs(new Date(midnightAsUtc + MS_PER_DAY), timeZone),
  ];
  const onDate = candidates.filter((ms) => localDateOf(new Date(ms), timeZone) === date);
  if (onDate.length === 0) {
    throw new RangeError(`Cannot resolve the start of ${date} in ${timeZone}`);
  }
  return new Date(Math.min(...onDate));
}

/** Half-open UTC interval `[start, end)` covering local dates `first`..`last` inclusive. */
export interface InstantRange {
  start: Date;
  end: Date;
}

export function localDaysRange(
  first: LocalDate,
  last: LocalDate = first,
  timeZone: string = BUSINESS_TIME_ZONE,
): InstantRange {
  const start = startOfLocalDay(first, timeZone);
  const end = startOfLocalDay(addCalendarDays(last, 1), timeZone);
  if (end <= start) {
    throw new RangeError(`Range end ${last} is before start ${first}`);
  }
  return { start, end };
}

/**
 * Exclusive deadline of a window that lasts until the end of the `days`-th
 * calendar day after the local date of `from` (that date is day 0). An event
 * at `t` is inside the window when `t < deadline`. Example (R21): a return
 * may be requested until `calendarDayDeadline(deliveredAt, 14)`.
 */
export function calendarDayDeadline(
  from: Date,
  days: number,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`days must be a non-negative integer, got ${days}`);
  }
  return startOfLocalDay(addCalendarDays(localDateOf(from, timeZone), days + 1), timeZone);
}
