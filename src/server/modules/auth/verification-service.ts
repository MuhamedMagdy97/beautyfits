import {
  Prisma,
  type Account,
  type Customer,
  type OtpChallenge,
  type PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction } from "@/server/db/transaction";
import { getEmailSender, type EmailSender } from "@/server/email/email";
import { AppError } from "@/server/errors/app-error";
import { isPendingExpired, type RequestMeta } from "@/server/modules/auth/auth-service";
import {
  claimOtpSend,
  deliverOtpEmail,
  issueOtpChallenge,
  OTP_POLICY,
  OTP_SEND_IP_LIMIT,
  OTP_VERIFY_IP_LIMIT,
  attemptOtpCode,
} from "@/server/modules/auth/otp";
import { createScryptHasher, type PasswordHasher } from "@/server/modules/auth/password-hash";
import { revokeAccountSessions } from "@/server/modules/auth/sessions";
import { generateToken, hashToken, isWellFormedToken } from "@/server/modules/auth/tokens";
import { getBlockedUntil, recordHit, secondsUntil } from "@/server/rate-limit/rate-limit";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Email verification and password recovery (TASK-008; User Flows §3.1, §3.2).
 *
 * Business rules: Q42, Q158–Q161, R23 (reset revokes every session), R30
 * (email is the only OTP channel; the account becomes ACTIVE once its email
 * is verified). Technical design: ADR-0014.
 *
 * Requests that start from an email address answer the same way whether or
 * not an account exists, and the send limits are counted per email either
 * way, so they do not reveal which emails are registered.
 */

export interface VerificationServiceDeps {
  db: PrismaClient;
  clock: Clock;
  hasher: PasswordHasher;
  email: EmailSender;
}

export interface VerifiedEmail {
  accountId: string;
  status: Account["status"];
  emailVerified: true;
}

export interface ResetGrant {
  resetToken: string;
  resetTokenExpiresAt: Date;
}

type AccountWithCustomer = Account & { customer: Customer | null };

type CustomerOtpPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

function ipKey(prefix: string, ip: string | null): string {
  return `${prefix}:ip:${ip ?? "unknown"}`;
}

function rateLimited(until: Date, now: Date): AppError {
  return new AppError("AUTH_RATE_LIMITED", "Too many attempts. Try again later.", {
    details: { retryAfterSeconds: secondsUntil(until, now) },
  });
}

function invalidCode(details: Record<string, unknown> = {}): AppError {
  return new AppError("AUTH_OTP_INVALID", "The code is incorrect.", { details });
}

function expiredCode(): AppError {
  return new AppError("AUTH_OTP_EXPIRED", "The code has expired. Request a new one.");
}

export function createVerificationService(deps: VerificationServiceDeps) {
  const { db, clock, hasher, email: sender } = deps;

  async function assertNotBlocked(key: string, now: Date): Promise<void> {
    const until = await getBlockedUntil(db, key, now);
    if (until) {
      throw rateLimited(until, now);
    }
  }

  /** The account a code of this purpose would go to, or null (answered silently). */
  async function findRecipient(
    purpose: CustomerOtpPurpose,
    email: string,
    now: Date,
  ): Promise<AccountWithCustomer | null> {
    if (purpose === "EMAIL_VERIFICATION") {
      const pending = await db.account.findMany({
        where: {
          accountType: "CUSTOMER",
          email,
          status: "PENDING_VERIFICATION",
          emailVerifiedAt: null,
        },
        include: { customer: true },
        orderBy: { createdAt: "desc" },
      });
      return pending.find((account) => !isPendingExpired(account, now)) ?? null;
    }
    // Password reset: only an active account with this verified email.
    return db.account.findFirst({
      where: {
        accountType: "CUSTOMER",
        email,
        emailVerifiedAt: { not: null },
        status: "ACTIVE",
      },
      include: { customer: true },
    });
  }

  /**
   * Sends a new code (Q160 resend; forgot-password starts here too). Limits:
   * 60 s cooldown and 5 per hour per purpose and email, 20 per hour per IP.
   */
  async function sendCode(
    input: { email: string; purpose: CustomerOtpPurpose },
    meta: RequestMeta,
  ): Promise<{ cooldownSeconds: number }> {
    const now = clock.now();
    const sendIpKey = ipKey("otp:send", meta.ip);
    await assertNotBlocked(sendIpKey, now);
    const claim = await claimOtpSend(db, input.purpose, input.email, now);
    if (!claim.allowed) {
      throw rateLimited(claim.until, now);
    }
    await recordHit(db, sendIpKey, OTP_SEND_IP_LIMIT, now);

    const cooldownSeconds = OTP_POLICY.resendCooldownMs / 1000;
    const account = await findRecipient(input.purpose, input.email, now);
    if (!account) {
      meta.logger.info("one-time code requested for no eligible account", {
        purpose: input.purpose,
      });
      return { cooldownSeconds };
    }
    const issued = await issueOtpChallenge(
      db,
      { accountId: account.id, purpose: input.purpose, destination: account.email, ip: meta.ip },
      now,
    );
    await deliverOtpEmail(
      sender,
      meta.logger,
      input.purpose,
      { accountId: account.id, locale: account.customer?.preferredLocale ?? "ar" },
      issued,
    );
    return { cooldownSeconds };
  }

  /**
   * Checks a code against the newest open challenge (Q158/Q159). Every
   * attempt counts; after 5 the code is dead and a new one must be requested.
   * A correct code is consumed and cannot be used again.
   */
  async function consumeCode(
    purpose: CustomerOtpPurpose,
    email: string,
    code: string,
    meta: RequestMeta,
  ): Promise<OtpChallenge> {
    const now = clock.now();
    const verifyIpKey = ipKey("otp:verify", meta.ip);
    await assertNotBlocked(verifyIpKey, now);

    const fail = async (error: AppError): Promise<never> => {
      await recordHit(db, verifyIpKey, OTP_VERIFY_IP_LIMIT, now);
      meta.logger.warn("one-time code rejected", { purpose, reason: error.code });
      throw error;
    };

    // Customer codes only: an employee may share the email (R15).
    const challenge = await db.otpChallenge.findFirst({
      where: {
        purpose,
        destination: email,
        supersededAt: null,
        consumedAt: null,
        account: { accountType: "CUSTOMER" },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) {
      return fail(invalidCode());
    }
    if (challenge.expiresAt <= now) {
      return fail(expiredCode());
    }
    const attempt = await attemptOtpCode(db, challenge, code, now);
    if (!attempt.ok) {
      return fail(
        invalidCode(
          attempt.attemptsRemaining === undefined
            ? {}
            : { attemptsRemaining: attempt.attemptsRemaining },
        ),
      );
    }
    return { ...challenge, consumedAt: now };
  }

  /**
   * Verifies the email with its code (Q42). The account becomes ACTIVE and its
   * phone is recorded as confirmed for this account (R30; DB design §3.2).
   */
  async function verifyEmail(
    input: { email: string; code: string },
    meta: RequestMeta,
  ): Promise<VerifiedEmail> {
    const challenge = await consumeCode("EMAIL_VERIFICATION", input.email, input.code, meta);
    const now = clock.now();
    const accountId = challenge.accountId;
    if (!accountId) {
      throw invalidCode();
    }
    try {
      const account = await runInTransaction(
        async (tx) => {
          const found = await tx.account.findUnique({
            where: { id: accountId },
            include: { customer: true },
          });
          if (!found || isPendingExpired(found, now)) {
            throw invalidCode();
          }
          if (found.emailVerifiedAt !== null) {
            return found;
          }
          if (found.status !== "PENDING_VERIFICATION") {
            throw new AppError("FORBIDDEN", "This account is not active.");
          }
          await tx.customer.update({
            where: { accountId: found.id },
            data: { phoneVerifiedAt: now },
          });
          return tx.account.update({
            where: { id: found.id },
            data: { emailVerifiedAt: now, status: "ACTIVE" },
          });
        },
        {},
        db,
      );
      meta.logger.info("customer email verified; account active", { accountId: account.id });
      return { accountId: account.id, status: account.status, emailVerified: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Another account verified this email or took this phone first.
        const phone = JSON.stringify(error.meta ?? {}).includes("phone");
        meta.logger.warn("email verification conflict", { field: phone ? "phone" : "email" });
        throw new AppError(
          "CONFLICT",
          phone
            ? "Another account already uses this phone number."
            : "An account with this email already exists. Log in or recover your password.",
          { details: { field: phone ? "phone" : "email" } },
        );
      }
      throw error;
    }
  }

  /**
   * Checks a password-reset code (User Flows §3.2) and returns a single-use
   * reset token, valid for 10 minutes, that authorizes setting a new password.
   */
  async function verifyRecoveryCode(
    input: { email: string; code: string },
    meta: RequestMeta,
  ): Promise<ResetGrant> {
    const challenge = await consumeCode("PASSWORD_RESET", input.email, input.code, meta);
    const now = clock.now();
    const resetToken = generateToken("reset");
    const resetTokenExpiresAt = new Date(now.getTime() + OTP_POLICY.resetGrantTtlMs);
    await db.otpChallenge.update({
      where: { id: challenge.id },
      data: { grantTokenHash: hashToken(resetToken), grantExpiresAt: resetTokenExpiresAt },
    });
    meta.logger.info("password reset code verified", { accountId: challenge.accountId });
    return { resetToken, resetTokenExpiresAt };
  }

  /** Sets the new password and revokes every session of the account (R23). */
  async function resetPassword(
    input: { resetToken: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const now = clock.now();
    if (!isWellFormedToken("reset", input.resetToken)) {
      throw invalidCode();
    }
    const challenge = await db.otpChallenge.findUnique({
      where: { grantTokenHash: hashToken(input.resetToken) },
      include: { account: true },
    });
    if (!challenge || challenge.grantUsedAt !== null || !challenge.account) {
      throw invalidCode();
    }
    if (!challenge.grantExpiresAt || challenge.grantExpiresAt <= now) {
      throw expiredCode();
    }
    const account = challenge.account;
    if (account.status !== "ACTIVE") {
      throw new AppError("FORBIDDEN", "This account is not active.");
    }

    const passwordHash = await hasher.hash(input.newPassword);
    const revoked = await runInTransaction(
      async (tx) => {
        const claimed = await tx.otpChallenge.updateMany({
          where: { id: challenge.id, grantUsedAt: null },
          data: { grantUsedAt: now },
        });
        if (claimed.count === 0) {
          throw invalidCode();
        }
        await tx.account.update({
          where: { id: account.id },
          data: { passwordHash, passwordChangedAt: now },
        });
        return revokeAccountSessions(tx, account.id, "PASSWORD_RESET", now);
      },
      {},
      db,
    );
    meta.logger.info("customer password reset; all sessions revoked", {
      accountId: account.id,
      revokedCount: revoked,
    });
  }

  return { sendCode, verifyEmail, verifyRecoveryCode, resetPassword };
}

export type VerificationService = ReturnType<typeof createVerificationService>;

let defaultService: VerificationService | undefined;

/** The process-wide service used by route handlers. */
export function getVerificationService(): VerificationService {
  defaultService ??= createVerificationService({
    db: getDb(),
    clock: systemClock,
    hasher: createScryptHasher(),
    email: getEmailSender(),
  });
  return defaultService;
}
