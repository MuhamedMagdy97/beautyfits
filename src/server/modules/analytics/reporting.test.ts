import { describe, expect, it } from "vitest";
import { resolvePeriod } from "@/server/modules/analytics/reporting-service";
import { reportQuerySchema } from "@/server/modules/analytics/schemas";

/** Reporting periods in Africa/Cairo days (TASK-051, Q149, R20). */

const parse = (query: Record<string, string>) => reportQuerySchema.safeParse(query);

describe("report periods", () => {
  // 2026-10-13T22:30Z is already 2026-10-14 01:30 in Cairo (UTC+3 in October).
  const now = new Date("2026-10-13T22:30:00Z");

  it("uses Cairo calendar days", () => {
    const today = resolvePeriod(parse({ range: "TODAY" }).data!, now);
    expect([today.from, today.to]).toEqual(["2026-10-14", "2026-10-14"]);
    expect(today.start.toISOString()).toBe("2026-10-13T21:00:00.000Z");
    expect(today.end.toISOString()).toBe("2026-10-14T21:00:00.000Z");

    const yesterday = resolvePeriod(parse({ range: "YESTERDAY" }).data!, now);
    expect([yesterday.from, yesterday.to]).toEqual(["2026-10-13", "2026-10-13"]);
  });

  it("ends 7D/30D/90D today and defaults to 30D", () => {
    expect(resolvePeriod(parse({ range: "7D" }).data!, now).from).toBe("2026-10-08");
    const thirty = resolvePeriod(parse({}).data!, now);
    expect([thirty.range, thirty.from, thirty.to]).toEqual(["30D", "2026-09-15", "2026-10-14"]);
    expect(resolvePeriod(parse({ range: "90D" }).data!, now).from).toBe("2026-07-17");
  });

  it("validates custom ranges", () => {
    const custom = parse({ range: "CUSTOM", from: "2026-01-01", to: "2026-01-31" });
    expect(resolvePeriod(custom.data!, now)).toMatchObject({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(parse({ range: "CUSTOM", from: "2026-01-01" }).success).toBe(false);
    expect(parse({ range: "CUSTOM", from: "2026-02-01", to: "2026-01-31" }).success).toBe(false);
    expect(parse({ range: "CUSTOM", from: "2025-01-01", to: "2026-01-02" }).success).toBe(false);
    expect(parse({ range: "CUSTOM", from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
    expect(parse({ range: "WEEK" }).success).toBe(false);
  });
});
