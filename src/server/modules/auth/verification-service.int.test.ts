import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import type { EmailMessage, EmailSender } from "@/server/email/email";
import { AppError, type ErrorCode } from "@/server/errors/app-error";
import { createLogger } from "@/server/logging/logger";
import { createAuthService, type RequestMeta } from "@/server/modules/auth/auth-service";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { createVerificationService } from "@/server/modules/auth/verification-service";
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

const db = getDb();
const START = new Date("2026-10-01T10:00:00.000Z").getTime();
let nowMs = START;
const clock = { now: () => new Date(nowMs) };
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 });

const outbox: EmailMessage[] = [];
let failSends = false;
const email: EmailSender = {
  async send(message) {
    if (failSends) {
      throw new Error("provider down");
    }
    outbox.push(message);
  },
};

const auth = createAuthService({ db, clock, hasher, email });
const verification = createVerificationService({ db, clock, hasher, email });

const logLines: string[] = [];
const logger = createLogger({ level: "debug", write: (_level, line) => logLines.push(line) });

const PASSWORD = "teal lantern over the nile";
const NEW_PASSWORD = "violet kettle on the balcony";
const EMAIL = "sara@example.com";

function meta(ip: string | null = "203.0.113.7"): RequestMeta {
  return { ip, userAgent: "vitest", logger };
}

function advance(ms: number): void {
  nowMs += ms;
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  return expect.unreachable(`expected ${code}`);
}

/** The code in the newest email to `to`. */
function lastCode(to = EMAIL): string {
  const message = outbox.findLast((m) => m.to === to);
  const match = message && /\b(\d{6})\b/.exec(message.text);
  if (!match) {
    throw new Error(`no code emailed to ${to}`);
  }
  return match[1];
}

function wrong(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

async function register(
  overrides: { email?: string; phone?: string; preferredLocale?: "ar" | "en" } = {},
) {
  return auth.register(
    {
      email: overrides.email ?? EMAIL,
      phone: overrides.phone ?? "+201012345678",
      password: PASSWORD,
      fullName: "Sara Ali",
      preferredLocale: overrides.preferredLocale ?? "en",
    },
    meta(),
  );
}

/** Registered and verified through the real flow. */
async function activeCustomer(overrides: { email?: string; phone?: string } = {}) {
  const registered = await register(overrides);
  const address = overrides.email ?? EMAIL;
  await verification.verifyEmail({ email: address, code: lastCode(address) }, meta());
  return registered;
}

beforeEach(async () => {
  await resetDatabase();
  nowMs = START;
  outbox.length = 0;
  logLines.length = 0;
  failSends = false;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("registration email (Q42)", () => {
  it("emails a 6-digit verification code in the customer's language", async () => {
    const registered = await register({ preferredLocale: "ar" });
    expect(registered.verificationCodeSent).toBe(true);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(EMAIL);
    expect(outbox[0].subject).toMatch(/[؀-ۿ]/);

    const challenge = await db.otpChallenge.findFirstOrThrow();
    expect(challenge).toMatchObject({
      accountId: registered.accountId,
      purpose: "EMAIL_VERIFICATION",
      channel: "EMAIL",
      destination: EMAIL,
      attemptCount: 0,
      maxAttempts: 5,
      expiresAt: new Date(START + 5 * MS_PER_MINUTE),
    });
    expect(challenge.codeHash).not.toContain(lastCode());
  });

  it("keeps the registration when the email cannot be sent", async () => {
    failSends = true;
    const registered = await register();
    expect(registered.verificationCodeSent).toBe(false);
    expect(await db.account.count()).toBe(1);
    expect(logLines.some((line) => line.includes("could not be sent"))).toBe(true);
  });
});

describe("verify-email-otp", () => {
  it("verifies the email and activates the account (R30)", async () => {
    const registered = await register();
    const result = await verification.verifyEmail({ email: EMAIL, code: lastCode() }, meta());
    expect(result).toEqual({
      accountId: registered.accountId,
      status: "ACTIVE",
      emailVerified: true,
    });
    const account = await db.account.findUniqueOrThrow({
      where: { id: registered.accountId },
      include: { customer: true },
    });
    expect(account.emailVerifiedAt).toEqual(new Date(START));
    expect(account.customer?.phoneVerifiedAt).toEqual(new Date(START));

    // The customer can now log in.
    const signedIn = await auth.login({ email: EMAIL, password: PASSWORD }, meta());
    expect(signedIn.view.account.status).toBe("ACTIVE");
  });

  it("makes the phone unique once the account is active (R30)", async () => {
    await activeCustomer({ phone: "+201112345678" });
    const error = await expectCode(
      register({ email: "other@example.com", phone: "+201112345678" }),
      "CONFLICT",
    );
    expect(error.details).toEqual({ field: "phone" });
  });

  it("rejects wrong codes and kills the code after 5 attempts (Q158)", async () => {
    await register();
    const code = lastCode();
    for (const remaining of [4, 3, 2, 1, 0]) {
      const error = await expectCode(
        verification.verifyEmail({ email: EMAIL, code: wrong(code) }, meta()),
        "AUTH_OTP_INVALID",
      );
      expect(error.details).toEqual({ attemptsRemaining: remaining });
    }
    const error = await expectCode(
      verification.verifyEmail({ email: EMAIL, code }, meta()),
      "AUTH_OTP_INVALID",
    );
    expect(error.details).toEqual({ attemptsRemaining: 0 });
    expect((await db.account.findFirstOrThrow()).status).toBe("PENDING_VERIFICATION");
  });

  it("expires codes after 5 minutes (Q159)", async () => {
    await register();
    const code = lastCode();
    advance(5 * MS_PER_MINUTE);
    await expectCode(verification.verifyEmail({ email: EMAIL, code }, meta()), "AUTH_OTP_EXPIRED");
  });

  it("accepts a code only once", async () => {
    await register();
    const code = lastCode();
    await verification.verifyEmail({ email: EMAIL, code }, meta());
    await expectCode(verification.verifyEmail({ email: EMAIL, code }, meta()), "AUTH_OTP_INVALID");
  });

  it("answers an unknown email like a wrong code", async () => {
    await expectCode(
      verification.verifyEmail({ email: "nobody@example.com", code: "123456" }, meta()),
      "AUTH_OTP_INVALID",
    );
  });

  it("blocks an IP after 30 wrong codes in 15 minutes (Q161)", async () => {
    await register();
    for (let i = 0; i < 30; i++) {
      await expectCode(
        verification.verifyEmail({ email: "nobody@example.com", code: "000000" }, meta()),
        "AUTH_OTP_INVALID",
      );
    }
    const error = await expectCode(
      verification.verifyEmail({ email: EMAIL, code: lastCode() }, meta()),
      "AUTH_RATE_LIMITED",
    );
    expect(error.details).toEqual({ retryAfterSeconds: 15 * 60 });
    // Another IP is not affected.
    await verification.verifyEmail({ email: EMAIL, code: lastCode() }, meta("198.51.100.1"));
  });

  it("does not verify an expired pending account", async () => {
    await register();
    const code = lastCode();
    advance(24 * MS_PER_HOUR);
    await expectCode(verification.verifyEmail({ email: EMAIL, code }, meta()), "AUTH_OTP_EXPIRED");
  });
});

describe("resend-otp (Q160)", () => {
  it("waits 60 seconds between codes, and a new code replaces the old one", async () => {
    await register();
    const first = lastCode();
    const error = await expectCode(
      verification.sendCode({ email: EMAIL, purpose: "EMAIL_VERIFICATION" }, meta()),
      "AUTH_RATE_LIMITED",
    );
    expect(error.details).toEqual({ retryAfterSeconds: 60 });

    advance(60 * MS_PER_SECOND);
    const result = await verification.sendCode(
      { email: EMAIL, purpose: "EMAIL_VERIFICATION" },
      meta(),
    );
    expect(result).toEqual({ cooldownSeconds: 60 });
    expect(outbox).toHaveLength(2);
    const second = lastCode();

    if (second !== first) {
      await expectCode(
        verification.verifyEmail({ email: EMAIL, code: first }, meta()),
        "AUTH_OTP_INVALID",
      );
    }
    await verification.verifyEmail({ email: EMAIL, code: second }, meta());
  });

  it("sends at most 5 codes per hour to one email", async () => {
    await register(); // 1st code
    for (let i = 0; i < 4; i++) {
      advance(61 * MS_PER_SECOND);
      await verification.sendCode({ email: EMAIL, purpose: "EMAIL_VERIFICATION" }, meta());
    }
    advance(61 * MS_PER_SECOND);
    await expectCode(
      verification.sendCode({ email: EMAIL, purpose: "EMAIL_VERIFICATION" }, meta()),
      "AUTH_RATE_LIMITED",
    );
    expect(outbox).toHaveLength(5);
  });

  it("answers the same for an email without an account, and still applies the cooldown", async () => {
    const result = await verification.sendCode(
      { email: "nobody@example.com", purpose: "EMAIL_VERIFICATION" },
      meta(),
    );
    expect(result).toEqual({ cooldownSeconds: 60 });
    expect(outbox).toHaveLength(0);
    await expectCode(
      verification.sendCode({ email: "nobody@example.com", purpose: "EMAIL_VERIFICATION" }, meta()),
      "AUTH_RATE_LIMITED",
    );
  });

  it("sends nothing for an email that is already verified", async () => {
    await activeCustomer();
    advance(61 * MS_PER_SECOND);
    await verification.sendCode({ email: EMAIL, purpose: "EMAIL_VERIFICATION" }, meta());
    expect(outbox).toHaveLength(1);
  });

  it("limits code requests per IP to 20 per hour", async () => {
    for (let i = 0; i < 20; i++) {
      await verification.sendCode(
        { email: `n${i}@example.com`, purpose: "PASSWORD_RESET" },
        meta(),
      );
    }
    await expectCode(
      verification.sendCode({ email: "n99@example.com", purpose: "PASSWORD_RESET" }, meta()),
      "AUTH_RATE_LIMITED",
    );
  });
});

describe("password recovery (User Flows §3.2, R23)", () => {
  async function recoveryToken(): Promise<string> {
    advance(61 * MS_PER_SECOND);
    await verification.sendCode({ email: EMAIL, purpose: "PASSWORD_RESET" }, meta());
    const grant = await verification.verifyRecoveryCode({ email: EMAIL, code: lastCode() }, meta());
    expect(grant.resetToken).toMatch(/^bfp_/);
    expect(grant.resetTokenExpiresAt).toEqual(new Date(nowMs + 10 * MS_PER_MINUTE));
    return grant.resetToken;
  }

  it("resets the password and revokes every session", async () => {
    await activeCustomer();
    const phone = await auth.login({ email: EMAIL, password: PASSWORD }, meta());
    const laptop = await auth.login({ email: EMAIL, password: PASSWORD }, meta());

    const resetToken = await recoveryToken();
    expect(outbox.at(-1)?.subject).toMatch(/password reset/i);
    await verification.resetPassword({ resetToken, newPassword: NEW_PASSWORD }, meta());

    for (const session of [phone, laptop]) {
      await expectCode(auth.authenticate(session.tokens.accessToken), "UNAUTHENTICATED");
    }
    const reasons = (await db.authSession.findMany()).map((s) => s.revokeReason);
    expect(reasons).toEqual(["PASSWORD_RESET", "PASSWORD_RESET"]);
    await expectCode(
      auth.login({ email: EMAIL, password: PASSWORD }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
    await auth.login({ email: EMAIL, password: NEW_PASSWORD }, meta());
  });

  it("uses a reset token only once and only for 10 minutes", async () => {
    await activeCustomer();
    const used = await recoveryToken();
    await verification.resetPassword({ resetToken: used, newPassword: NEW_PASSWORD }, meta());
    await expectCode(
      verification.resetPassword({ resetToken: used, newPassword: PASSWORD }, meta()),
      "AUTH_OTP_INVALID",
    );

    const late = await recoveryToken();
    advance(10 * MS_PER_MINUTE);
    await expectCode(
      verification.resetPassword({ resetToken: late, newPassword: PASSWORD }, meta()),
      "AUTH_OTP_EXPIRED",
    );
    await expectCode(
      verification.resetPassword({ resetToken: "bfp_not-a-token", newPassword: PASSWORD }, meta()),
      "AUTH_OTP_INVALID",
    );
  });

  it("sends reset codes only to active accounts, answering the same otherwise", async () => {
    await register({ email: "pending@example.com", phone: "+201212345678" });
    await activeCustomer();
    await db.account.updateMany({ where: { email: EMAIL }, data: { status: "SUSPENDED" } });
    outbox.length = 0;
    for (const address of ["pending@example.com", EMAIL, "nobody@example.com"]) {
      const result = await verification.sendCode(
        { email: address, purpose: "PASSWORD_RESET" },
        meta(),
      );
      expect(result).toEqual({ cooldownSeconds: 60 });
    }
    expect(outbox).toHaveLength(0);
  });

  it("does not accept a verification code as a reset code", async () => {
    await register();
    await expectCode(
      verification.verifyRecoveryCode({ email: EMAIL, code: lastCode() }, meta()),
      "AUTH_OTP_INVALID",
    );
  });

  it("never logs codes, reset tokens or email addresses", async () => {
    await activeCustomer();
    const resetToken = await recoveryToken();
    await verification.resetPassword({ resetToken, newPassword: NEW_PASSWORD }, meta());
    const text = logLines.join("\n");
    expect(logLines.length).toBeGreaterThan(0);
    for (const message of outbox) {
      expect(text).not.toContain(/\b(\d{6})\b/.exec(message.text)?.[1]);
    }
    expect(text).not.toContain(resetToken);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(NEW_PASSWORD);
  });
});
