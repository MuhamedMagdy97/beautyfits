import { describe, expect, it } from "vitest";
import { normalizeEgyptianMobile, normalizeEmail } from "@/server/modules/auth/identifiers";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Sara.Ali@Example.COM ")).toBe("sara.ali@example.com");
  });
});

describe("normalizeEgyptianMobile (R27)", () => {
  it.each([
    ["01012345678", "+201012345678"],
    ["01112345678", "+201112345678"],
    ["01212345678", "+201212345678"],
    ["01512345678", "+201512345678"],
    ["+201012345678", "+201012345678"],
    ["00201012345678", "+201012345678"],
    [" 010 1234 5678 ", "+201012345678"],
    ["010-1234-5678", "+201012345678"],
    ["٠١٠١٢٣٤٥٦٧٨", "+201012345678"],
    ["۰۱۰۱۲۳۴۵۶۷۸", "+201012345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeEgyptianMobile(input)).toBe(expected);
  });

  it.each([
    ["01312345678", "prefix 013"],
    ["01412345678", "prefix 014"],
    ["01612345678", "prefix 016"],
    ["0101234567", "too short"],
    ["010123456789", "too long"],
    ["1012345678", "no leading 0"],
    ["+2001012345678", "+20 followed by 0"],
    ["0223456789", "Cairo landline"],
    ["+966512345678", "foreign number"],
    ["0101234567a", "letter"],
    ["", "empty"],
  ])("rejects %s (%s)", (input) => {
    expect(normalizeEgyptianMobile(input)).toBeNull();
  });
});
