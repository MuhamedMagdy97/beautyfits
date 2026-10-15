import { describe, expect, it } from "vitest";
import { countPath, percent, reportQuery } from "./analytics";
import { ANALYTICS_DICTIONARIES } from "./analytics-i18n";

describe("reportQuery", () => {
  it("passes preset ranges through", () => {
    expect(reportQuery("TODAY")).toBe("range=TODAY");
    expect(reportQuery("7D", "2026-01-01", "2026-01-02")).toBe("range=7D");
  });

  it("needs both days of a custom range, the end not before the start", () => {
    expect(reportQuery("CUSTOM", "2026-10-01", "2026-10-15")).toBe(
      "range=CUSTOM&from=2026-10-01&to=2026-10-15",
    );
    expect(reportQuery("CUSTOM", "2026-10-01", "2026-10-01")).toBe(
      "range=CUSTOM&from=2026-10-01&to=2026-10-01",
    );
    expect(reportQuery("CUSTOM")).toBeNull();
    expect(reportQuery("CUSTOM", "2026-10-01", "")).toBeNull();
    expect(reportQuery("CUSTOM", "2026-10-15", "2026-10-01")).toBeNull();
    expect(reportQuery("CUSTOM", "2026-10-01&x=1", "2026-10-15")).toBeNull();
  });
});

describe("percent", () => {
  it("is a whole percent and 0 when there is nothing to compare with", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 5)).toBe(100);
    expect(percent(5, 0)).toBe(0);
  });
});

describe("countPath", () => {
  it("asks for one item per page so totalPages is the count", () => {
    expect(countPath("/a")).toBe("/a?pageSize=1");
    expect(countPath("/a?status=NEW")).toBe("/a?status=NEW&pageSize=1");
  });
});

describe("analytics texts", () => {
  it("has the same keys in Arabic and English", () => {
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, inner]) =>
        typeof inner === "object" ? keys(inner).map((k) => `${key}.${k}`) : [key],
      );
    expect(keys(ANALYTICS_DICTIONARIES.ar).sort()).toEqual(keys(ANALYTICS_DICTIONARIES.en).sort());
  });
});
