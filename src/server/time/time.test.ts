import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addHours,
  addMilliseconds,
  BUSINESS_TIME_ZONE,
  calendarDayDeadline,
  fixedClock,
  isLocalDate,
  isValidTimeZone,
  localDateOf,
  localDaysRange,
  parseTimestamp,
  startOfLocalDay,
  timeZoneOffsetMs,
  toIsoUtc,
} from "@/server/time/time";

const at = (iso: string) => new Date(iso);
const HOUR = 60 * 60 * 1000;

describe("UTC instants", () => {
  it("serializes to ISO-8601 UTC", () => {
    expect(toIsoUtc(at("2026-09-30T15:00:00+03:00"))).toBe("2026-09-30T12:00:00.000Z");
    expect(() => toIsoUtc(new Date("nope"))).toThrow(RangeError);
  });

  it("parses timestamps only when they carry an offset", () => {
    expect(parseTimestamp("2026-09-30T12:00:00Z").toISOString()).toBe("2026-09-30T12:00:00.000Z");
    expect(parseTimestamp("2026-09-30T15:00:00.5+03:00").toISOString()).toBe(
      "2026-09-30T12:00:00.500Z",
    );
    for (const bad of [
      "2026-09-30T12:00:00",
      "2026-09-30",
      "30/09/2026",
      "2026-13-40T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-09-30T24:00:00Z",
      "2026-09-30T12:60:00Z",
      "2026-09-30T12:00:00+25:00",
    ]) {
      expect(() => parseTimestamp(bad), bad).toThrow(RangeError);
    }
  });

  it("accepts offsets from -12:00 to +14:00 only", () => {
    expect(parseTimestamp("2026-09-30T23:00:00+14:00").toISOString()).toBe(
      "2026-09-30T09:00:00.000Z",
    );
    expect(parseTimestamp("2026-09-30T00:00:00-12:00").toISOString()).toBe(
      "2026-09-30T12:00:00.000Z",
    );
    expect(parseTimestamp("2026-09-30T12:00:00+05:45").toISOString()).toBe(
      "2026-09-30T06:15:00.000Z",
    );
    for (const bad of [
      "2026-09-30T12:00:00+14:01",
      "2026-09-30T12:00:00+14:30",
      "2026-09-30T12:00:00+14:59",
      "2026-09-30T12:00:00+15:00",
      "2026-09-30T12:00:00-12:01",
      "2026-09-30T12:00:00-13:00",
      "2026-09-30T12:00:00+03:60",
      "2026-09-30T12:00:00+0300",
    ]) {
      expect(() => parseTimestamp(bad), bad).toThrow(RangeError);
    }
  });

  it("accepts at most millisecond precision", () => {
    expect(parseTimestamp("2026-09-30T12:00:00.1Z").toISOString()).toBe("2026-09-30T12:00:00.100Z");
    expect(parseTimestamp("2026-09-30T12:00:00.12Z").toISOString()).toBe(
      "2026-09-30T12:00:00.120Z",
    );
    expect(parseTimestamp("2026-09-30T12:00:00.123Z").toISOString()).toBe(
      "2026-09-30T12:00:00.123Z",
    );
    // Round-trips its own output.
    expect(toIsoUtc(parseTimestamp("2026-09-30T12:00:00.999Z"))).toBe("2026-09-30T12:00:00.999Z");
    for (const bad of [
      "2026-09-30T12:00:00.1234Z",
      "2026-09-30T12:00:00.123456789Z",
      "2026-09-30T12:00:00.Z",
      "2026-09-30T12:00.5Z",
    ]) {
      expect(() => parseTimestamp(bad), bad).toThrow(RangeError);
    }
  });

  it("adds exact durations regardless of DST", () => {
    // 72 hours across the Egypt DST end (2026-10-29 24:00 → 23:00) is still 72 h elapsed.
    const created = at("2026-10-28T12:00:00Z");
    expect(addHours(created, 72).getTime() - created.getTime()).toBe(72 * HOUR);
    expect(addHours(created, 72).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(addHours(created, -72).toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(addMilliseconds(created, 1).toISOString()).toBe("2026-10-28T12:00:00.001Z");
  });

  it("rejects NaN, Infinity and fractional durations", () => {
    const created = at("2026-10-28T12:00:00Z");
    for (const bad of [NaN, Infinity, -Infinity, 1.5, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => addHours(created, bad), `hours ${bad}`).toThrow(RangeError);
      expect(() => addMilliseconds(created, bad), `ms ${bad}`).toThrow(RangeError);
    }
    expect(() => addMilliseconds(new Date("nope"), 1)).toThrow(RangeError);
  });

  it("rejects results outside the Date range", () => {
    expect(() => addMilliseconds(at("2026-10-28T12:00:00Z"), 8.64e15)).toThrow(RangeError);
    expect(() => addHours(at("2026-10-28T12:00:00Z"), 3_000_000_000)).toThrow(RangeError);
  });

  it("provides a fixed clock for tests", () => {
    const clock = fixedClock("2026-09-30T12:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-09-30T12:00:00.000Z");
    clock.now().setFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-09-30T12:00:00.000Z");
  });
});

describe("business timezone (R20)", () => {
  it("is Africa/Cairo", () => {
    expect(BUSINESS_TIME_ZONE).toBe("Africa/Cairo");
    expect(isValidTimeZone(BUSINESS_TIME_ZONE)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("applies Egypt daylight saving time", () => {
    expect(timeZoneOffsetMs(at("2026-01-15T12:00:00Z"), BUSINESS_TIME_ZONE)).toBe(2 * HOUR);
    expect(timeZoneOffsetMs(at("2026-07-15T12:00:00Z"), BUSINESS_TIME_ZONE)).toBe(3 * HOUR);
  });

  it("maps instants to Cairo calendar dates", () => {
    expect(localDateOf(at("2026-09-30T20:59:59Z"))).toBe("2026-09-30"); // 23:59:59 +03
    expect(localDateOf(at("2026-09-30T21:00:00Z"))).toBe("2026-10-01"); // 00:00 +03
    expect(localDateOf(at("2026-01-15T21:59:59Z"))).toBe("2026-01-15"); // 23:59:59 +02
    expect(localDateOf(at("2026-01-15T22:00:00Z"))).toBe("2026-01-16");
  });
});

describe("local dates", () => {
  it("validates and shifts calendar dates", () => {
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-9-30")).toBe(false);
    expect(addCalendarDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(() => addCalendarDays("2026-03-01", 1.5)).toThrow(RangeError);
    expect(() => addCalendarDays("bad", 1)).toThrow(RangeError);
  });

  it("finds local midnight in standard and summer time", () => {
    expect(startOfLocalDay("2026-01-15").toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(startOfLocalDay("2026-07-15").toISOString()).toBe("2026-07-14T21:00:00.000Z");
  });

  it("handles the DST start, when midnight does not exist (00:00 → 01:00)", () => {
    // 2026-04-24 starts at 01:00 +03, which is 2026-04-23T22:00Z.
    expect(startOfLocalDay("2026-04-24").toISOString()).toBe("2026-04-23T22:00:00.000Z");
    const day = localDaysRange("2026-04-24");
    expect(day.end.getTime() - day.start.getTime()).toBe(23 * HOUR);
  });

  it("handles the DST end, when 23:00–24:00 repeats", () => {
    expect(startOfLocalDay("2026-10-30").toISOString()).toBe("2026-10-29T22:00:00.000Z");
    const day = localDaysRange("2026-10-29");
    expect(day.end.getTime() - day.start.getTime()).toBe(25 * HOUR);
  });

  it("builds half-open ranges for analytics days (Today, Yesterday, custom)", () => {
    const today = localDateOf(at("2026-09-30T12:00:00Z"));
    const range = localDaysRange(today);
    expect(range.start.toISOString()).toBe("2026-09-29T21:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    const custom = localDaysRange("2026-09-01", "2026-09-30");
    expect(custom.start.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(custom.end.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(() => localDaysRange("2026-09-30", "2026-09-01")).toThrow(RangeError);
  });
});

describe("calendarDayDeadline (R21 return window)", () => {
  it("ends at the end of the 14th calendar day after the Cairo delivery date", () => {
    // Delivered 23:00 Cairo on 30 Sep (day 0) → open until the end of 14 Oct Cairo.
    const deadline = calendarDayDeadline(at("2026-09-30T20:00:00Z"), 14);
    expect(deadline.toISOString()).toBe("2026-10-14T21:00:00.000Z");
    expect(at("2026-10-14T20:59:59.999Z") < deadline).toBe(true);
    expect(at("2026-10-14T21:00:00.000Z") < deadline).toBe(false);
  });

  it("uses the Cairo date, not the UTC date, of the delivery", () => {
    // 21:30Z on 30 Sep is 00:30 on 1 Oct in Cairo → day 0 is 1 Oct.
    expect(calendarDayDeadline(at("2026-09-30T21:30:00Z"), 14).toISOString()).toBe(
      "2026-10-15T21:00:00.000Z",
    );
  });

  it("follows the DST change inside the window", () => {
    // Day 0 = 20 Oct (+03); window ends at the start of 4 Nov (+02).
    expect(calendarDayDeadline(at("2026-10-20T10:00:00Z"), 14).toISOString()).toBe(
      "2026-11-03T22:00:00.000Z",
    );
  });

  it("rejects negative or fractional day counts", () => {
    expect(() => calendarDayDeadline(at("2026-09-30T12:00:00Z"), -1)).toThrow(RangeError);
    expect(() => calendarDayDeadline(at("2026-09-30T12:00:00Z"), 1.5)).toThrow(RangeError);
  });
});
