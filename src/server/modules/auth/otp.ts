import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type {
  AuthDomain,
  Locale,
  OtpChallenge,
  OtpPurpose,
  PrismaClient,
} from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import type { EmailMessage, EmailSender } from "@/server/email/email";
import type { Logger } from "@/server/logging/logger";
import { getBlockedUntil, recordHit, type RateLimitPolicy } from "@/server/rate-limit/rate-limit";
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "@/server/time/time";

/**
 * One-time codes (TASK-008, ADR-0014). Business values: Q158–Q161, R30.
 * Codes are 6 random digits; only a SHA-256 hash bound to the challenge id is
 * stored, and comparison is constant-time.
 */
export const OTP_POLICY = {
  codeLength: 6,
  /** Q159: a code expires 5 minutes after it is sent. */
  ttlMs: 5 * MS_PER_MINUTE,
  /** Q158: 5 attempts per code. */
  maxAttempts: 5,
  /** Q160: a new code can be requested 60 seconds after the previous one. */
  resendCooldownMs: 60 * MS_PER_SECOND,
  /** A verified password-reset code grants this long to set the new password (ADR-0014). */
  resetGrantTtlMs: 10 * MS_PER_MINUTE,
} as const;

/** Q160: one code per purpose and email per 60 seconds. */
export const OTP_SEND_COOLDOWN: RateLimitPolicy = {
  limit: 1,
  windowMs: OTP_POLICY.resendCooldownMs,
  blockMs: OTP_POLICY.resendCooldownMs,
};

/** Q158/Q161 abuse limit (ADR-0014): at most 5 codes per purpose and email per hour. */
export const OTP_SEND_HOURLY_LIMIT: RateLimitPolicy = {
  limit: 5,
  windowMs: MS_PER_HOUR,
  blockMs: MS_PER_HOUR,
};

/** Q161 abuse limit (ADR-0014): at most 20 codes requested from one IP per hour. */
export const OTP_SEND_IP_LIMIT: RateLimitPolicy = {
  limit: 20,
  windowMs: MS_PER_HOUR,
  blockMs: MS_PER_HOUR,
};

/** Q161 abuse limit (ADR-0014): 30 wrong codes from one IP in 15 minutes block it for 15 minutes. */
export const OTP_VERIFY_IP_LIMIT: RateLimitPolicy = {
  limit: 30,
  windowMs: 15 * MS_PER_MINUTE,
  blockMs: 15 * MS_PER_MINUTE,
};

/** Purposes whose codes are sent so far (more follow in TASK-009/010). */
export type OtpEmailPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "EMPLOYEE_LOGIN";

/**
 * Language of a code email: the customer's preferred language (R14), or both
 * languages for staff, who have no language preference (ADR-0015).
 */
export type EmailLocale = Locale | "bilingual";

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_POLICY.codeLength)).padStart(OTP_POLICY.codeLength, "0");
}

export function hashOtpCode(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

export function otpCodeMatches(challenge: Pick<OtpChallenge, "id" | "codeHash">, code: string) {
  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(hashOtpCode(challenge.id, code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Counter keys never contain the raw email. */
export function emailDigest(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

export interface IssuedOtp {
  challenge: OtpChallenge;
  code: string;
}

/**
 * Creates a challenge and supersedes every earlier open challenge of the same
 * account with the same purpose and destination, so only the newest code
 * works. Scoping by account keeps a customer's and an employee's codes for a
 * shared email apart (R15). `grant` attaches a single-use token at creation
 * (the employee login ticket, TASK-011).
 */
export async function issueOtpChallenge(
  db: Db,
  input: {
    accountId: string;
    purpose: OtpPurpose;
    destination: string;
    ip: string | null;
    grant?: { tokenHash: string; expiresAt: Date };
  },
  now: Date,
): Promise<IssuedOtp> {
  await db.otpChallenge.updateMany({
    where: {
      accountId: input.accountId,
      purpose: input.purpose,
      destination: input.destination,
      consumedAt: null,
      supersededAt: null,
    },
    data: { supersededAt: now },
  });
  const id = crypto.randomUUID();
  const code = generateOtpCode();
  const challenge = await db.otpChallenge.create({
    data: {
      id,
      accountId: input.accountId,
      purpose: input.purpose,
      channel: "EMAIL",
      destination: input.destination,
      codeHash: hashOtpCode(id, code),
      maxAttempts: OTP_POLICY.maxAttempts,
      expiresAt: new Date(now.getTime() + OTP_POLICY.ttlMs),
      lastSentAt: now,
      grantTokenHash: input.grant?.tokenHash ?? null,
      grantExpiresAt: input.grant?.expiresAt ?? null,
      ipAddress: input.ip,
      createdAt: now,
    },
  });
  return { challenge, code };
}

export type OtpAttempt = { ok: true } | { ok: false; attemptsRemaining?: number };

/**
 * Checks a code against one open, unexpired challenge (Q158). Every attempt
 * is counted with a conditional update, so concurrent guesses cannot exceed
 * the limit; after the last attempt the code is dead. A correct code is
 * consumed and cannot be used again.
 */
export async function attemptOtpCode(
  db: Db,
  challenge: OtpChallenge,
  code: string,
  now: Date,
): Promise<OtpAttempt> {
  const counted = await db.otpChallenge.updateMany({
    where: {
      id: challenge.id,
      consumedAt: null,
      supersededAt: null,
      attemptCount: { lt: challenge.maxAttempts },
    },
    data: { attemptCount: { increment: 1 } },
  });
  if (counted.count === 0) {
    return { ok: false, attemptsRemaining: 0 };
  }
  const attemptsUsed = Math.min(challenge.attemptCount + 1, challenge.maxAttempts);
  if (!otpCodeMatches(challenge, code)) {
    return { ok: false, attemptsRemaining: challenge.maxAttempts - attemptsUsed };
  }
  const consumed = await db.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: now },
  });
  return consumed.count === 0 ? { ok: false } : { ok: true };
}

// ---------------------------------------------------------------------------
// Email content (R14: per language)

const MINUTES = OTP_POLICY.ttlMs / MS_PER_MINUTE;

const TEMPLATES: Record<
  OtpEmailPurpose,
  Record<Locale, (code: string) => { subject: string; text: string }>
> = {
  EMAIL_VERIFICATION: {
    en: (code) => ({
      subject: "Your BeautyFits verification code",
      text:
        `Your BeautyFits verification code is ${code}.\n\n` +
        `It expires in ${MINUTES} minutes. Do not share it with anyone.\n\n` +
        "If you did not create a BeautyFits account, you can ignore this email.\n",
    }),
    ar: (code) => ({
      subject: "رمز التحقق من BeautyFits",
      text:
        `رمز التحقق الخاص بك في BeautyFits هو ${code}.\n\n` +
        `ينتهي الرمز خلال ${MINUTES} دقائق. لا تشاركه مع أي شخص.\n\n` +
        "إذا لم تقم بإنشاء حساب في BeautyFits، يمكنك تجاهل هذه الرسالة.\n",
    }),
  },
  PASSWORD_RESET: {
    en: (code) => ({
      subject: "Your BeautyFits password reset code",
      text:
        `Your BeautyFits password reset code is ${code}.\n\n` +
        `It expires in ${MINUTES} minutes. Do not share it with anyone.\n\n` +
        "If you did not ask to reset your password, you can ignore this email. Your password has not changed.\n",
    }),
    ar: (code) => ({
      subject: "رمز إعادة تعيين كلمة المرور في BeautyFits",
      text:
        `رمز إعادة تعيين كلمة المرور الخاص بك في BeautyFits هو ${code}.\n\n` +
        `ينتهي الرمز خلال ${MINUTES} دقائق. لا تشاركه مع أي شخص.\n\n` +
        "إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة. لم تتغير كلمة المرور.\n",
    }),
  },
  EMPLOYEE_LOGIN: {
    en: (code) => ({
      subject: "Your BeautyFits staff sign-in code",
      text:
        `Your BeautyFits staff sign-in code is ${code}.\n\n` +
        `It expires in ${MINUTES} minutes. Do not share it with anyone.\n\n` +
        "If you did not just sign in, change your password and tell the store owner.\n",
    }),
    ar: (code) => ({
      subject: "رمز تسجيل دخول الموظفين في BeautyFits",
      text:
        `رمز تسجيل دخول الموظفين الخاص بك في BeautyFits هو ${code}.\n\n` +
        `ينتهي الرمز خلال ${MINUTES} دقائق. لا تشاركه مع أي شخص.\n\n` +
        "إذا لم تحاول تسجيل الدخول الآن، غيّر كلمة المرور وأبلغ صاحب المتجر.\n",
    }),
  },
};

export function otpEmail(
  purpose: OtpEmailPurpose,
  locale: EmailLocale,
  to: string,
  code: string,
): EmailMessage {
  if (locale !== "bilingual") {
    return { to, ...TEMPLATES[purpose][locale](code) };
  }
  // Arabic first, then English (R14).
  const ar = TEMPLATES[purpose].ar(code);
  const en = TEMPLATES[purpose].en(code);
  return { to, subject: `${ar.subject} | ${en.subject}`, text: `${ar.text}\n---\n\n${en.text}` };
}

// ---------------------------------------------------------------------------
// Sending

/**
 * Customer keys are `otp:send:<purpose>:<digest>`; employee keys add the
 * domain, so a customer and an employee sharing an email (R15) never use
 * up each other's limits.
 */
function sendKeys(domain: AuthDomain, purpose: OtpEmailPurpose, email: string) {
  const digest = emailDigest(email);
  const scope = domain === "CUSTOMER" ? purpose : `${domain}:${purpose}`;
  return {
    cooldown: `otp:send:${scope}:${digest}`,
    hourly: `otp:send-hour:${scope}:${digest}`,
  };
}

/**
 * Sends a code by email after the transaction that created it committed.
 * A failed send is logged and never undoes the committed change; the user
 * can request a new code after the cooldown (ADR-0014).
 */
export async function deliverOtpEmail(
  sender: EmailSender,
  logger: Logger,
  purpose: OtpEmailPurpose,
  recipient: { accountId: string; locale: EmailLocale },
  issued: IssuedOtp,
): Promise<boolean> {
  try {
    await sender.send(
      otpEmail(purpose, recipient.locale, issued.challenge.destination, issued.code),
    );
    logger.info("one-time code sent", {
      accountId: recipient.accountId,
      purpose,
      challengeId: issued.challenge.id,
    });
    return true;
  } catch (error) {
    logger.error("one-time code email could not be sent", {
      accountId: recipient.accountId,
      purpose,
      challengeId: issued.challenge.id,
      err: error,
    });
    return false;
  }
}

/**
 * Counts one code send for `email` against the cooldown and hourly limits.
 * Returns false (and counts nothing) when either limit is already reached.
 */
export async function claimOtpSend(
  db: PrismaClient,
  purpose: OtpEmailPurpose,
  email: string,
  now: Date,
  domain: AuthDomain = "CUSTOMER",
): Promise<{ allowed: true } | { allowed: false; until: Date }> {
  const keys = sendKeys(domain, purpose, email);
  for (const key of [keys.cooldown, keys.hourly]) {
    const until = await getBlockedUntil(db, key, now);
    if (until) {
      return { allowed: false, until };
    }
  }
  await recordHit(db, keys.cooldown, OTP_SEND_COOLDOWN, now);
  await recordHit(db, keys.hourly, OTP_SEND_HOURLY_LIMIT, now);
  return { allowed: true };
}
