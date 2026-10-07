import { describe, expect, it } from "vitest";
import { PERMISSION_CODES } from "@/server/modules/rbac/catalog";
import { findSection, NAV_GROUPS, safeNextPath, visibleNav } from "./navigation";

describe("dashboard navigation", () => {
  it("uses only catalog permission codes and unique slugs", () => {
    const sections = NAV_GROUPS.flatMap((group) => group.sections);
    for (const section of sections) {
      expect(section.anyOf.length).toBeGreaterThan(0);
      for (const code of section.anyOf) {
        expect(PERMISSION_CODES).toContain(code);
      }
    }
    const slugs = sections.map((section) => section.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("shows nothing without permissions and everything with all of them", () => {
    expect(visibleNav([])).toEqual([]);
    expect(visibleNav(PERMISSION_CODES)).toEqual(NAV_GROUPS);
  });

  it("shows a section when any one of its permissions is held, dropping empty groups", () => {
    const nav = visibleNav(["ORDERS_VIEW", "SUPPLIER_FINANCE_VIEW"]);
    expect(nav.map((group) => group.id)).toEqual(["sales", "purchasing"]);
    expect(nav.flatMap((group) => group.sections.map((s) => s.slug))).toEqual([
      "orders",
      "suppliers",
    ]);
  });

  it("finds sections by slug", () => {
    expect(findSection("audit-logs")?.anyOf).toEqual(["VIEW_AUDIT_LOGS"]);
    expect(findSection("nope")).toBeUndefined();
  });

  it("only redirects to dashboard paths after sign-in", () => {
    expect(safeNextPath("/staff/orders?page=2")).toBe("/staff/orders?page=2");
    expect(safeNextPath("/staff")).toBe("/staff");
    for (const bad of [
      null,
      undefined,
      "",
      "https://evil.example/staff",
      "//evil.example",
      "/\\evil.example",
      "/staffing",
      "/account",
      "/staff/login",
    ]) {
      expect(safeNextPath(bad)).toBe("/staff");
    }
  });
});
