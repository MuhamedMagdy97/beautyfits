import type { OtpChallenge, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { getEmailSender, type EmailSender } from "@/server/email/email";
import { AppError } from "@/server/errors/app-error";
import { AUDIT_ENTITY_TYPES, recordAudit, type AuditActor } from "@/server/modules/audit/audit";
import {
  loginAccountKey,
  toView,
  type AccountView,
  type CustomerPrincipal,
  type RequestMeta,
} from "@/server/modules/auth/auth-service";
import {
  attemptOtpCode,
  claimOtpSend,
  deliverOtpEmail,
  issueOtpChallenge,
  OTP_POLICY,
  OTP_SEND_IP_LIMIT,
  OTP_VERIFY_IP_LIMIT,
} from "@/server/modules/auth/otp";
import { createScryptHasher, type PasswordHasher } from "@/server/modules/auth/password-hash";
import { LOGIN_ACCOUNT_LIMIT } from "@/server/modules/auth/policy";
import { revokeAccountSessions } from "@/server/modules/auth/sessions";
import { conflict, isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import { changeNoticeEmail, type ChangeNotice } from "@/server/modules/customers/notices";
import type { UpdateProfileInput } from "@/server/modules/customers/schemas";
import { OPEN_ORDER_STATUSES } from "@/server/modules/orders/orders";
import { walletBalance } from "@/server/modules/wallet/wallet-service";
import {
  getBlockedUntil,
  recordHit,
  resetBucket,
  secondsUntil,
} from "@/server/rate-limit/rate-limit";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Customer profile (TASK-009, API §11, User Flows §3.3–§3.4, ADR-0030).
 *
 * - Email change (Q152): current password, then a code sent to the new
 *   email; the previous email is notified.
 * - Phone change (Q153 as amended by R30): current password, then a code
 *   sent to the verified account email; the email is notified.
 * - Wrong passwords count toward the R24 account lock, as for a password
 *   change. Code limits are those of ADR-0014.
 * - An email or phone verified by another customer account is refused when
 *   the code is requested and again when it is used.
 */

type ChangePurpose = "EMAIL_CHANGE" | "PHONE_CHANGE";

export interface CodeSent {
  /** False when the email could not be sent; the client offers to resend after the cooldown. */
  codeSent: boolean;
  cooldownSeconds: number;
}

function rateLimited(until: Date, now: Date): AppError {
  return new AppError("AUTH_RATE_LIMITED", "Too many attempts. Try again later.", {
    details: { retryAfterSeconds: secondsUntil(until, now) },
  });
}

function emailTaken(): AppError {
  return conflict("An account with this email already exists.", { field: "email" });
}

function phoneTaken(): AppError {
  return conflict("Another account already uses this phone number.", { field: "phone" });
}

function customerActor(principal: CustomerPrincipal): AuditActor {
  return { type: "CUSTOMER", id: principal.customerId };
}

/** The name left on a deactivated, anonymized customer (R34). */
export const DELETED_NAME = "Deleted customer";

async function lockCustomerRow(tx: Db, customerId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
}

/**
 * R34: deactivation is refused while the customer has an open order, an open
 * return or a non-zero wallet balance (held credit included), with
 * `409 CONFLICT`, `details.reason = ACCOUNT_HAS_OPEN_ITEMS` and the open
 * items. TASK-037 (returns) adds its check here.
 */
async function assertNothingOpen(tx: Db, customerId: string): Promise<void> {
  const openItems: string[] = [];
  const openOrder = await tx.order.findFirst({
    where: { customerId, status: { in: [...OPEN_ORDER_STATUSES] } },
    select: { id: true },
  });
  if (openOrder) {
    openItems.push("OPEN_ORDER");
  }
  if ((await walletBalance(tx, customerId)) !== BigInt(0)) {
    openItems.push("WALLET_BALANCE");
  }
  if (openItems.length > 0) {
    throw conflict("Finish open orders and settle the wallet before deactivating the account.", {
      reason: "ACCOUNT_HAS_OPEN_ITEMS",
      openItems,
    });
  }
}

function ipKey(prefix: string, ip: string | null): string {
  return `${prefix}:ip:${ip ?? "unknown"}`;
}

export function createProfileService(deps: {
  db: PrismaClient;
  clock: Clock;
  hasher: PasswordHasher;
  email: EmailSender;
}) {
  const { db, clock, hasher, email: sender } = deps;

  async function loadView(accountId: string): Promise<AccountView> {
    return toView(
      await db.account.findUniqueOrThrow({ where: { id: accountId }, include: { customer: true } }),
    );
  }

  /** Re-authentication with the current password (R24 lock applies). */
  async function checkPassword(
    principal: CustomerPrincipal,
    password: string,
    meta: RequestMeta,
    now: Date,
  ): Promise<void> {
    const key = loginAccountKey(principal.view.account.email);
    const until = await getBlockedUntil(db, key, now);
    if (until) {
      throw rateLimited(until, now);
    }
    const account = await db.account.findUniqueOrThrow({ where: { id: principal.accountId } });
    if (!(await hasher.verify(password, account.passwordHash))) {
      await recordHit(db, key, LOGIN_ACCOUNT_LIMIT, now);
      meta.logger.warn("customer re-authentication failed", { accountId: account.id });
      throw new AppError("AUTH_INVALID_CREDENTIALS", "Current password is incorrect.");
    }
    await resetBucket(db, key);
  }

  /** Counts the send against the IP and per-email limits, then issues and emails the code. */
  async function sendChangeCode(
    principal: CustomerPrincipal,
    purpose: ChangePurpose,
    destination: string,
    pendingValue: string | undefined,
    meta: RequestMeta,
    now: Date,
  ): Promise<CodeSent> {
    const sendIpKey = ipKey("otp:send", meta.ip);
    const ipUntil = await getBlockedUntil(db, sendIpKey, now);
    if (ipUntil) {
      throw rateLimited(ipUntil, now);
    }
    const claim = await claimOtpSend(db, purpose, destination, now);
    if (!claim.allowed) {
      throw rateLimited(claim.until, now);
    }
    await recordHit(db, sendIpKey, OTP_SEND_IP_LIMIT, now);
    const issued = await issueOtpChallenge(
      db,
      { accountId: principal.accountId, purpose, destination, ip: meta.ip, pendingValue },
      now,
    );
    const codeSent = await deliverOtpEmail(
      sender,
      meta.logger,
      purpose,
      { accountId: principal.accountId, locale: principal.view.customer.preferredLocale },
      issued,
    );
    return { codeSent, cooldownSeconds: OTP_POLICY.resendCooldownMs / 1000 };
  }

  /** Uses a code of the newest open challenge of this account and purpose (Q158/Q159). */
  async function consumeChangeCode(
    principal: CustomerPrincipal,
    purpose: ChangePurpose,
    code: string,
    meta: RequestMeta,
  ): Promise<OtpChallenge> {
    const now = clock.now();
    const verifyIpKey = ipKey("otp:verify", meta.ip);
    const until = await getBlockedUntil(db, verifyIpKey, now);
    if (until) {
      throw rateLimited(until, now);
    }
    const fail = async (error: AppError): Promise<never> => {
      await recordHit(db, verifyIpKey, OTP_VERIFY_IP_LIMIT, now);
      meta.logger.warn("one-time code rejected", { purpose, reason: error.code });
      throw error;
    };
    const challenge = await db.otpChallenge.findFirst({
      where: { accountId: principal.accountId, purpose, consumedAt: null, supersededAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) {
      return fail(new AppError("AUTH_OTP_INVALID", "The code is incorrect."));
    }
    if (challenge.expiresAt <= now) {
      return fail(new AppError("AUTH_OTP_EXPIRED", "The code has expired. Request a new one."));
    }
    const attempt = await attemptOtpCode(db, challenge, code, now);
    if (!attempt.ok) {
      return fail(
        new AppError("AUTH_OTP_INVALID", "The code is incorrect.", {
          details:
            attempt.attemptsRemaining === undefined
              ? {}
              : { attemptsRemaining: attempt.attemptsRemaining },
        }),
      );
    }
    return challenge;
  }

  async function notify(
    principal: CustomerPrincipal,
    notice: ChangeNotice,
    to: string,
    meta: RequestMeta,
  ) {
    try {
      await sender.send(changeNoticeEmail(notice, principal.view.customer.preferredLocale, to));
    } catch (error) {
      // The change is committed; a lost notice is logged, never undone (ADR-0014).
      meta.logger.error("change notice email could not be sent", {
        accountId: principal.accountId,
        notice,
        err: error,
      });
    }
  }

  async function emailTakenByOther(tx: Db, email: string, accountId: string): Promise<boolean> {
    const other = await tx.account.findFirst({
      where: {
        accountType: "CUSTOMER",
        email,
        emailVerifiedAt: { not: null },
        NOT: { id: accountId },
      },
      select: { id: true },
    });
    return other !== null;
  }

  async function phoneTakenByOther(tx: Db, phone: string, customerId: string): Promise<boolean> {
    const other = await tx.customer.findFirst({
      where: { phone, phoneVerifiedAt: { not: null }, NOT: { id: customerId } },
      select: { id: true },
    });
    return other !== null;
  }

  /** `PATCH /me`: name, language, date of birth. Never touches order snapshots. */
  async function updateProfile(
    principal: CustomerPrincipal,
    input: UpdateProfileInput,
  ): Promise<AccountView> {
    await db.customer.update({
      where: { id: principal.customerId },
      data: {
        fullName: input.fullName,
        preferredLocale: input.preferredLocale,
        dateOfBirth:
          input.dateOfBirth === undefined
            ? undefined
            : input.dateOfBirth === null
              ? null
              : new Date(`${input.dateOfBirth}T00:00:00Z`),
      },
    });
    return loadView(principal.accountId);
  }

  /** `POST /me/change-email`: password check, then a code to the new email. */
  async function requestEmailChange(
    principal: CustomerPrincipal,
    input: { currentPassword: string; newEmail: string },
    meta: RequestMeta,
  ): Promise<CodeSent> {
    const now = clock.now();
    if (input.newEmail === principal.view.account.email) {
      throw validationError("newEmail", "same_as_current", "This is already your email.");
    }
    await checkPassword(principal, input.currentPassword, meta, now);
    if (await emailTakenByOther(db, input.newEmail, principal.accountId)) {
      throw emailTaken();
    }
    return sendChangeCode(principal, "EMAIL_CHANGE", input.newEmail, undefined, meta, now);
  }

  /** `POST /me/change-email/verify`: switches the email and notifies the previous one. */
  async function confirmEmailChange(
    principal: CustomerPrincipal,
    input: { code: string },
    meta: RequestMeta,
  ): Promise<AccountView> {
    const challenge = await consumeChangeCode(principal, "EMAIL_CHANGE", input.code, meta);
    const now = clock.now();
    const newEmail = challenge.destination;
    const previousEmail = principal.view.account.email;
    try {
      await runInTransaction(
        async (tx) => {
          if (await emailTakenByOther(tx, newEmail, principal.accountId)) {
            throw emailTaken();
          }
          await tx.account.update({
            where: { id: principal.accountId },
            data: { email: newEmail, emailVerifiedAt: now },
          });
          await recordAudit(tx, {
            actor: customerActor(principal),
            action: "CUSTOMER_EMAIL_CHANGED",
            entityType: AUDIT_ENTITY_TYPES.customer,
            entityId: principal.customerId,
            previous: { email: previousEmail },
            next: { email: newEmail },
            correlationId: meta.requestId ?? null,
            createdAt: now,
          });
        },
        {},
        db,
      );
    } catch (error) {
      if (isUniqueViolation(error, "email")) {
        throw emailTaken();
      }
      throw error;
    }
    meta.logger.info("customer email changed", { accountId: principal.accountId });
    await notify(principal, "EMAIL_CHANGED", previousEmail, meta);
    return loadView(principal.accountId);
  }

  /** `POST /me/change-phone`: password check, then a code to the verified account email (R30). */
  async function requestPhoneChange(
    principal: CustomerPrincipal,
    input: { currentPassword: string; newPhone: string },
    meta: RequestMeta,
  ): Promise<CodeSent> {
    const now = clock.now();
    if (input.newPhone === principal.view.customer.phone) {
      throw validationError("newPhone", "same_as_current", "This is already your phone number.");
    }
    await checkPassword(principal, input.currentPassword, meta, now);
    if (await phoneTakenByOther(db, input.newPhone, principal.customerId)) {
      throw phoneTaken();
    }
    return sendChangeCode(
      principal,
      "PHONE_CHANGE",
      principal.view.account.email,
      input.newPhone,
      meta,
      now,
    );
  }

  /** `POST /me/change-phone/verify`: switches the phone and notifies the account email. */
  async function confirmPhoneChange(
    principal: CustomerPrincipal,
    input: { code: string },
    meta: RequestMeta,
  ): Promise<AccountView> {
    const challenge = await consumeChangeCode(principal, "PHONE_CHANGE", input.code, meta);
    const now = clock.now();
    const newPhone = challenge.pendingValue;
    if (!newPhone) {
      throw new AppError("AUTH_OTP_INVALID", "The code is incorrect.");
    }
    try {
      await runInTransaction(
        async (tx) => {
          if (await phoneTakenByOther(tx, newPhone, principal.customerId)) {
            throw phoneTaken();
          }
          await tx.customer.update({
            where: { id: principal.customerId },
            data: { phone: newPhone, phoneVerifiedAt: now },
          });
          await recordAudit(tx, {
            actor: customerActor(principal),
            action: "CUSTOMER_PHONE_CHANGED",
            entityType: AUDIT_ENTITY_TYPES.customer,
            entityId: principal.customerId,
            previous: { phone: principal.view.customer.phone },
            next: { phone: newPhone },
            correlationId: meta.requestId ?? null,
            createdAt: now,
          });
        },
        {},
        db,
      );
    } catch (error) {
      if (isUniqueViolation(error, "phone")) {
        throw phoneTaken();
      }
      throw error;
    }
    meta.logger.info("customer phone changed", { accountId: principal.accountId });
    await notify(principal, "PHONE_CHANGED", principal.view.account.email, meta);
    return loadView(principal.accountId);
  }

  /**
   * `POST /me/deactivate` (Q154, R34): current password, then in one
   * transaction the account is deactivated, every session revoked and the
   * profile wiped: name, email, phone, date of birth, addresses, codes and
   * the active cart (R35).
   * The email and phone are freed for a new registration. Orders, audit and
   * financial records keep their own snapshots. Cannot be undone.
   */
  async function deactivate(
    principal: CustomerPrincipal,
    input: { currentPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const now = clock.now();
    await checkPassword(principal, input.currentPassword, meta, now);
    await runInTransaction(
      async (tx) => {
        await lockCustomerRow(tx, principal.customerId);
        await assertNothingOpen(tx, principal.customerId);
        await revokeAccountSessions(tx, principal.accountId, "DEACTIVATED", now);
        await tx.otpChallenge.deleteMany({ where: { accountId: principal.accountId } });
        await tx.customerAddress.deleteMany({ where: { customerId: principal.customerId } });
        // R35: the active cart goes too (its lines cascade).
        await tx.cart.deleteMany({ where: { customerId: principal.customerId, status: "ACTIVE" } });
        await tx.customer.update({
          where: { id: principal.customerId },
          data: {
            fullName: DELETED_NAME,
            phone: "",
            phoneVerifiedAt: null,
            dateOfBirth: null,
            anonymizedAt: now,
          },
        });
        await tx.account.update({
          where: { id: principal.accountId },
          data: {
            // A placeholder that can never be a real login; frees the email (R34).
            email: `deleted-${principal.accountId}@invalid`,
            emailVerifiedAt: null,
            status: "DEACTIVATED",
            deactivatedAt: now,
          },
        });
        await recordAudit(tx, {
          actor: customerActor(principal),
          action: "CUSTOMER_DEACTIVATED",
          entityType: AUDIT_ENTITY_TYPES.customer,
          entityId: principal.customerId,
          correlationId: meta.requestId ?? null,
          createdAt: now,
        });
      },
      {},
      db,
    );
    meta.logger.info("customer deactivated and anonymized", { accountId: principal.accountId });
  }

  return {
    updateProfile,
    requestEmailChange,
    confirmEmailChange,
    requestPhoneChange,
    confirmPhoneChange,
    deactivate,
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;

let defaultService: ProfileService | undefined;

export function getProfileService(): ProfileService {
  defaultService ??= createProfileService({
    db: getDb(),
    clock: systemClock,
    hasher: createScryptHasher(),
    email: getEmailSender(),
  });
  return defaultService;
}
