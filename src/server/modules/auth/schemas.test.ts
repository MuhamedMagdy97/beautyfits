import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors/app-error";
import { localeFromAcceptLanguage } from "@/server/http/locale";
import { parseOptionalJsonBody, parseWith } from "@/server/http/validation";
import { refreshSchema, registerSchema } from "@/server/modules/auth/schemas";

const VALID = {
  email: " Sara@Example.com ",
  password: "teal lantern over the nile",
  phone: "010 1234 5678",
  fullName: "  Sara Ali ",
};

function issuesOf(fn: () => unknown) {
  try {
    fn();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).details.issues as { path: string; code: string }[];
  }
}

describe("registerSchema", () => {
  it("normalizes email, phone and name", () => {
    expect(parseWith(registerSchema, VALID)).toEqual({
      email: "sara@example.com",
      password: "teal lantern over the nile",
      phone: "+201012345678",
      fullName: "Sara Ali",
    });
  });

  it("reports stable codes for password and phone problems", () => {
    const issues = issuesOf(() =>
      parseWith(registerSchema, { ...VALID, password: "passwordpassword", phone: "01312345678" }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "password", code: "password_common" }),
        expect.objectContaining({ path: "phone", code: "phone_invalid" }),
      ]),
    );
  });

  it("requires a full name and a valid email", () => {
    const issues = issuesOf(() =>
      parseWith(registerSchema, { ...VALID, fullName: "   ", email: "not-an-email" }),
    );
    expect(issues.map((issue) => issue.path).sort()).toEqual(["email", "fullName"]);
  });

  it("rejects an unsupported locale", () => {
    const issues = issuesOf(() => parseWith(registerSchema, { ...VALID, preferredLocale: "fr" }));
    expect(issues[0].path).toBe("preferredLocale");
  });
});

describe("parseOptionalJsonBody", () => {
  it("treats an empty body as {}", async () => {
    const request = new Request("http://localhost/x", { method: "POST", body: "" });
    expect(await parseOptionalJsonBody(request, refreshSchema)).toEqual({});
  });

  it("still rejects malformed JSON", async () => {
    const request = new Request("http://localhost/x", { method: "POST", body: "{" });
    await expect(parseOptionalJsonBody(request, refreshSchema)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("localeFromAcceptLanguage", () => {
  it.each([
    [null, "ar"],
    ["en-US,en;q=0.9", "en"],
    ["fr-FR, en;q=0.5", "en"],
    ["en;q=0.4, ar-EG;q=0.8", "ar"],
    ["fr, de", "ar"],
    ["en;q=0", "ar"],
  ])("%s → %s", (header, expected) => {
    expect(localeFromAcceptLanguage(header)).toBe(expected);
  });
});
