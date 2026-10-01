import { describe, expect, it } from "vitest";
import {
  generateOtpCode,
  hashOtpCode,
  OTP_POLICY,
  OTP_SEND_COOLDOWN,
  otpCodeMatches,
  otpEmail,
} from "@/server/modules/auth/otp";

describe("one-time codes", () => {
  it("are 6 random digits", () => {
    const codes = new Set(Array.from({ length: 200 }, generateOtpCode));
    for (const code of codes) {
      expect(code).toMatch(/^\d{6}$/);
    }
    expect(codes.size).toBeGreaterThan(190);
  });

  it("are stored only as a hash bound to the challenge", () => {
    const hash = hashOtpCode("challenge-1", "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
    expect(hashOtpCode("challenge-2", "123456")).not.toBe(hash);
    expect(otpCodeMatches({ id: "challenge-1", codeHash: hash }, "123456")).toBe(true);
    expect(otpCodeMatches({ id: "challenge-1", codeHash: hash }, "123457")).toBe(false);
    expect(otpCodeMatches({ id: "challenge-2", codeHash: hash }, "123456")).toBe(false);
  });

  it("follow Q158–Q160: 5 minutes, 5 attempts, 60 s resend cooldown", () => {
    expect(OTP_POLICY.ttlMs).toBe(5 * 60_000);
    expect(OTP_POLICY.maxAttempts).toBe(5);
    expect(OTP_POLICY.resendCooldownMs).toBe(60_000);
    expect(OTP_SEND_COOLDOWN).toEqual({ limit: 1, windowMs: 60_000, blockMs: 60_000 });
  });
});

describe("code emails (R14)", () => {
  it("exist in Arabic and English and carry the code", () => {
    for (const purpose of ["EMAIL_VERIFICATION", "PASSWORD_RESET", "EMPLOYEE_LOGIN"] as const) {
      const en = otpEmail(purpose, "en", "sara@example.com", "024680");
      const ar = otpEmail(purpose, "ar", "sara@example.com", "024680");
      expect(en.to).toBe("sara@example.com");
      expect(en.text).toContain("024680");
      expect(ar.text).toContain("024680");
      expect(en.subject).toMatch(/BeautyFits/);
      expect(ar.subject).toMatch(/[؀-ۿ]/);
      expect(en.text).toContain("5 minutes");
    }
  });

  it("are bilingual for staff: Arabic first, then English (TASK-011)", () => {
    const message = otpEmail("EMPLOYEE_LOGIN", "bilingual", "mona@beautyfits.example", "024680");
    expect(message.subject).toBe(
      "رمز تسجيل دخول الموظفين في BeautyFits | Your BeautyFits staff sign-in code",
    );
    const arabic = message.text.indexOf("رمز تسجيل دخول الموظفين");
    const english = message.text.indexOf("Your BeautyFits staff sign-in code");
    expect(arabic).toBeGreaterThanOrEqual(0);
    expect(english).toBeGreaterThan(arabic);
  });
});
