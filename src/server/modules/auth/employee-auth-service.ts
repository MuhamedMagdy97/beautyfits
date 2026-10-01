import type {
  Account,
  Employee,
  EmployeeLevel,
  OtpChallenge,
  PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { getEmailSender, type EmailSender } from "@/server/email/email";
import { AppError } from "@/server/errors/app-error";
import type { RequestMeta } from "@/server/modules/auth/auth-service";
import {
  attemptOtpCode,
  claimOtpSend,
  deliverOtpEmail,
  emailDigest,
  issueOtpChallenge,
  OTP_POLICY,
  OTP_SEND_IP_LIMIT,
  OTP_VERIFY_IP_LIMIT,
  type IssuedOtp,
} from "@/server/modules/auth/otp";
import { createScryptHasher, type PasswordHasher } from "@/server/modules/auth/password-hash";
import {
  AUTH_POLICY,
  DEFAULT_STAFF_SESSION_SETTINGS,
  EMPLOYEE_AUTH_POLICY,
  EMPLOYEE_LOGIN_ACCOUNT_LIMIT,
  EMPLOYEE_LOGIN_IP_LIMIT,
  type StaffSessionSettings,
} from "@/server/modules/auth/policy";
import {
  createSession,
  issueTokenPair,
  revokeAccountSessions,
  revokeSession,
} from "@/server/modules/auth/sessions";
import { generateToken, hashToken, isWellFormedToken } from "@/server/modules/auth/tokens";
import type { IssuedTokens } from "@/server/modules/auth/transport";
import { readStaffSessionSettings } from "@/server/modules/settings/settings";
import {
  getBlockedUntil,
  recordHit,
  resetBucket,
  secondsUntil,
} from "@/server/rate-limit/rate-limit";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Employee authentication (TASK-011): login with email + password + email
 * code, 30-day trusted devices, staff sessions, refresh, logout, logout-all
 * and password recovery.
 *
 * Business rules: R28 (every employee, Owner/Admin included, confirms a new
 * device with an email code; the device is then trusted for 30 days), R29
 * (12 h / 60 min staff sessions, Owner/Admin-configurable; a password reset
 * revokes every session), R15 (an employee login is separate from a customer
 * login with the same email), Q158–Q161 (code limits). Technical design:
 * ADR-0013, ADR-0014, ADR-0015.
 */

export interface EmployeeView {
  account: { id: string; email: string; status: Account["status"] };
  employee: {
    id: string;
    displayName: string;
    level: EmployeeLevel;
    department: string | null;
  };
}

export interface EmployeeSessionInfo {
  /** Absolute end of the session (R29 maximum). */
  expiresAt: Date;
  /** The session ends after this many seconds without activity (R29 idle timeout). */
  idleTimeoutSeconds: number;
}

export interface EmployeePrincipal {
  accountId: string;
  employeeId: string;
  sessionId: string;
  session: EmployeeSessionInfo;
  view: EmployeeView;
}

export interface EmployeeSignedIn {
  view: EmployeeView;
  session: EmployeeSessionInfo;
  tokens: IssuedTokens;
  /** Set when this login trusted the device (after the email code, R28). */
  trustedDevice?: { token: string; expiresAt: Date };
}

export interface LoginTicket {
  loginTicket: string;
  loginTicketExpiresAt: Date;
  cooldownSeconds: number;
}

export type EmployeeLoginResult =
  | { otpRequired: false; signedIn: EmployeeSignedIn }
  | ({ otpRequired: true; codeSent: boolean } & LoginTicket);

export interface EmployeeAuthServiceDeps {
  db: PrismaClient;
  clock: Clock;
  hasher: PasswordHasher;
  /** Defaults to the configured sender (ADR-0014). */
  email?: EmailSender;
  /**
   * Current staff session settings (R29). Defaults to the R29 values; the
   * process-wide service reads them from the `settings` table (TASK-004).
   */
  sessionSettings?: () => Promise<StaffSessionSettings>;
}

type EmployeeAccount = Account & { employee: Employee | null };

const COOLDOWN_SECONDS = OTP_POLICY.resendCooldownMs / 1000;

function rateLimited(until: Date, now: Date): AppError {
  return new AppError("AUTH_RATE_LIMITED", "Too many attempts. Try again later.", {
    details: { retryAfterSeconds: secondsUntil(until, now) },
  });
}

function unauthenticated(): AppError {
  return new AppError("UNAUTHENTICATED", "Authentication required. Sign in again.");
}

function accountNotActive(): AppError {
  return new AppError("FORBIDDEN", "This account is not active.");
}

function invalidCode(details: Record<string, unknown> = {}): AppError {
  return new AppError("AUTH_OTP_INVALID", "The code is incorrect.", { details });
}

function expiredCode(): AppError {
  return new AppError("AUTH_OTP_EXPIRED", "The code has expired. Request a new one.");
}

function expiredTicket(): AppError {
  return new AppError("AUTH_OTP_EXPIRED", "The sign-in attempt has expired. Sign in again.");
}

function ipKey(prefix: string, ip: string | null): string {
  return `${prefix}:ip:${ip ?? "unknown"}`;
}

function loginAccountKey(email: string): string {
  return `employee-login:account:${emailDigest(email)}`;
}

/** Account and employee profile both ACTIVE (a deactivated employee keeps history, Q69). */
function isActiveEmployee(account: EmployeeAccount): account is EmployeeAccount & {
  employee: Employee;
} {
  return (
    account.accountType === "EMPLOYEE" &&
    account.status === "ACTIVE" &&
    account.employee !== null &&
    account.employee.status === "ACTIVE"
  );
}

function toView(account: EmployeeAccount & { employee: Employee }): EmployeeView {
  return {
    account: { id: account.id, email: account.email, status: account.status },
    employee: {
      id: account.employee.id,
      displayName: account.employee.displayName,
      level: account.employee.employeeLevel,
      department: account.employee.department,
    },
  };
}

function sessionInfo(expiresAt: Date, settings: StaffSessionSettings): EmployeeSessionInfo {
  return { expiresAt, idleTimeoutSeconds: Math.floor(settings.idleTimeoutMs / 1000) };
}

function isIdle(lastUsedAt: Date, now: Date, settings: StaffSessionSettings): boolean {
  return now.getTime() - lastUsedAt.getTime() >= settings.idleTimeoutMs;
}

export function createEmployeeAuthService(deps: EmployeeAuthServiceDeps) {
  const { db, clock, hasher } = deps;
  const emailSender = deps.email ?? getEmailSender();
  const getSettings = deps.sessionSettings ?? (async () => DEFAULT_STAFF_SESSION_SETTINGS);

  async function assertNotBlocked(keys: string[], now: Date): Promise<void> {
    for (const key of keys) {
      const until = await getBlockedUntil(db, key, now);
      if (until) {
        throw rateLimited(until, now);
      }
    }
  }

  async function findEmployeeAccount(email: string): Promise<EmployeeAccount | null> {
    // Employee emails are verified when the account is created (invitation, Q64).
    return db.account.findFirst({
      where: { accountType: "EMPLOYEE", email, emailVerifiedAt: { not: null } },
      include: { employee: true },
    });
  }

  /** Staff emails go out in Arabic and English (no language preference stored). */
  async function sendEmployeeCode(
    purpose: "EMPLOYEE_LOGIN" | "PASSWORD_RESET",
    accountId: string,
    issued: IssuedOtp,
    meta: RequestMeta,
  ): Promise<boolean> {
    return deliverOtpEmail(
      emailSender,
      meta.logger,
      purpose,
      { accountId, locale: "bilingual" },
      issued,
    );
  }

  /**
   * Counts one code send against the per-email limits (60 s cooldown, 5 per
   * hour; employee-only keys) and the per-IP limit (ADR-0014).
   */
  async function claimSend(
    purpose: "EMPLOYEE_LOGIN" | "PASSWORD_RESET",
    email: string,
    meta: RequestMeta,
    now: Date,
  ): Promise<void> {
    const sendIpKey = ipKey("otp:send", meta.ip);
    await assertNotBlocked([sendIpKey], now);
    const claim = await claimOtpSend(db, purpose, email, now, "EMPLOYEE");
    if (!claim.allowed) {
      throw rateLimited(claim.until, now);
    }
    await recordHit(db, sendIpKey, OTP_SEND_IP_LIMIT, now);
  }

  /**
   * Issues a login code bound to a new login ticket. Serialized per account,
   * so two concurrent requests cannot leave two open tickets.
   */
  async function issueLoginCode(
    account: EmployeeAccount,
    ticketExpiresAt: Date,
    meta: RequestMeta,
    now: Date,
    replacing?: OtpChallenge,
  ): Promise<{ issued: IssuedOtp; loginTicket: string }> {
    const loginTicket = generateToken("login");
    const issued = await runInTransaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-login:${account.id}`}))`;
        if (replacing) {
          const current = await tx.otpChallenge.findUnique({ where: { id: replacing.id } });
          if (!current || current.supersededAt !== null || current.consumedAt !== null) {
            throw invalidCode();
          }
        }
        return issueOtpChallenge(
          tx,
          {
            accountId: account.id,
            purpose: "EMPLOYEE_LOGIN",
            destination: account.email,
            ip: meta.ip,
            grant: { tokenHash: hashToken(loginTicket), expiresAt: ticketExpiresAt },
          },
          now,
        );
      },
      {},
      db,
    );
    return { issued, loginTicket };
  }

  async function startSession(
    tx: Db,
    account: EmployeeAccount & { employee: Employee },
    meta: RequestMeta,
    now: Date,
    settings: StaffSessionSettings,
  ) {
    const created = await createSession(
      tx,
      { accountId: account.id, domain: "EMPLOYEE", ttlMs: settings.maxLifetimeMs },
      meta,
      now,
    );
    await tx.account.update({ where: { id: account.id }, data: { lastLoginAt: now } });
    return created;
  }

  /**
   * Step 1: email + password. Throttled like customer login (R24 values,
   * employee-only keys). On a trusted device (R28) the employee is signed in;
   * otherwise a login code is emailed and a login ticket returned.
   */
  async function login(
    input: { email: string; password: string; deviceToken?: string },
    meta: RequestMeta,
  ): Promise<EmployeeLoginResult> {
    const now = clock.now();
    const accountKey = loginAccountKey(input.email);
    const loginIpKey = ipKey("employee-login", meta.ip);
    await assertNotBlocked([accountKey, loginIpKey], now);

    const account = await findEmployeeAccount(input.email);
    let passwordOk = false;
    if (account) {
      passwordOk = await hasher.verify(input.password, account.passwordHash);
    } else {
      await hasher.verifyDummy(input.password);
    }
    if (!account || !passwordOk) {
      const accountState = await recordHit(db, accountKey, EMPLOYEE_LOGIN_ACCOUNT_LIMIT, now);
      const ipState = await recordHit(db, loginIpKey, EMPLOYEE_LOGIN_IP_LIMIT, now);
      meta.logger.warn("employee login failed", { accountId: account?.id ?? null });
      if (accountState.blockedUntil && accountState.count >= EMPLOYEE_LOGIN_ACCOUNT_LIMIT.limit) {
        meta.logger.warn("employee login locked after repeated failures", {
          accountId: account?.id ?? null,
        });
      }
      if (ipState.blockedUntil && ipState.count >= EMPLOYEE_LOGIN_IP_LIMIT.limit) {
        meta.logger.warn("employee login blocked for client IP after repeated failures");
      }
      throw new AppError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    await resetBucket(db, accountKey);

    if (!isActiveEmployee(account)) {
      meta.logger.warn("employee login refused: account not active", { accountId: account.id });
      throw accountNotActive();
    }

    if (input.deviceToken && isWellFormedToken("device", input.deviceToken)) {
      const device = await db.employeeTrustedDevice.findFirst({
        where: {
          deviceTokenHash: hashToken(input.deviceToken),
          accountId: account.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (device) {
        const settings = await getSettings();
        const session = await runInTransaction(
          (tx) => startSession(tx, account, meta, now, settings),
          {},
          db,
        );
        meta.logger.info("employee logged in on a trusted device", {
          accountId: account.id,
          sessionId: session.sessionId,
          deviceId: device.id,
        });
        return {
          otpRequired: false,
          signedIn: {
            view: toView(account),
            session: sessionInfo(session.expiresAt, settings),
            tokens: session.tokens,
          },
        };
      }
    }

    await claimSend("EMPLOYEE_LOGIN", account.email, meta, now);
    const loginTicketExpiresAt = new Date(now.getTime() + EMPLOYEE_AUTH_POLICY.loginTicketTtlMs);
    const { issued, loginTicket } = await issueLoginCode(account, loginTicketExpiresAt, meta, now);
    const codeSent = await sendEmployeeCode("EMPLOYEE_LOGIN", account.id, issued, meta);
    meta.logger.info("employee login code required", { accountId: account.id });
    return {
      otpRequired: true,
      codeSent,
      loginTicket,
      loginTicketExpiresAt,
      cooldownSeconds: COOLDOWN_SECONDS,
    };
  }

  /** The open login challenge a ticket belongs to, or an error. */
  async function challengeForTicket(loginTicket: string, now: Date) {
    if (!isWellFormedToken("login", loginTicket)) {
      throw invalidCode();
    }
    const challenge = await db.otpChallenge.findUnique({
      where: { grantTokenHash: hashToken(loginTicket) },
      include: { account: { include: { employee: true } } },
    });
    if (
      !challenge ||
      !challenge.account ||
      challenge.purpose !== "EMPLOYEE_LOGIN" ||
      challenge.supersededAt !== null ||
      challenge.consumedAt !== null ||
      challenge.grantUsedAt !== null
    ) {
      throw invalidCode();
    }
    if (!challenge.grantExpiresAt || challenge.grantExpiresAt <= now) {
      throw expiredTicket();
    }
    return { challenge, account: challenge.account };
  }

  /**
   * Step 2: the emailed code (R28). A correct code signs the employee in and
   * trusts this device for 30 days.
   */
  async function verifyLoginCode(
    input: { loginTicket: string; code: string },
    meta: RequestMeta,
  ): Promise<EmployeeSignedIn> {
    const now = clock.now();
    const verifyIpKey = ipKey("otp:verify", meta.ip);
    await assertNotBlocked([verifyIpKey], now);
    const fail = async (error: AppError): Promise<never> => {
      await recordHit(db, verifyIpKey, OTP_VERIFY_IP_LIMIT, now);
      meta.logger.warn("employee login code rejected", { reason: error.code });
      throw error;
    };

    let found: Awaited<ReturnType<typeof challengeForTicket>>;
    try {
      found = await challengeForTicket(input.loginTicket, now);
    } catch (error) {
      return fail(error as AppError);
    }
    const { challenge, account } = found;
    if (challenge.expiresAt <= now) {
      return fail(expiredCode());
    }
    const attempt = await attemptOtpCode(db, challenge, input.code, now);
    if (!attempt.ok) {
      return fail(
        invalidCode(
          attempt.attemptsRemaining === undefined
            ? {}
            : { attemptsRemaining: attempt.attemptsRemaining },
        ),
      );
    }
    if (!isActiveEmployee(account)) {
      throw accountNotActive();
    }

    const settings = await getSettings();
    const deviceToken = generateToken("device");
    const deviceExpiresAt = new Date(now.getTime() + EMPLOYEE_AUTH_POLICY.trustedDeviceTtlMs);
    const session = await runInTransaction(
      async (tx) => {
        const claimed = await tx.otpChallenge.updateMany({
          where: { id: challenge.id, grantUsedAt: null },
          data: { grantUsedAt: now },
        });
        if (claimed.count === 0) {
          throw invalidCode();
        }
        await tx.employeeTrustedDevice.create({
          data: {
            accountId: account.id,
            deviceTokenHash: hashToken(deviceToken),
            verifiedAt: now,
            expiresAt: deviceExpiresAt,
            ipAddress: meta.ip,
            userAgent: meta.userAgent?.slice(0, 512) ?? null,
            createdAt: now,
          },
        });
        return startSession(tx, account, meta, now, settings);
      },
      {},
      db,
    );
    meta.logger.info("employee logged in with email code; device trusted", {
      accountId: account.id,
      sessionId: session.sessionId,
    });
    return {
      view: toView(account),
      session: sessionInfo(session.expiresAt, settings),
      tokens: session.tokens,
      trustedDevice: { token: deviceToken, expiresAt: deviceExpiresAt },
    };
  }

  /**
   * Sends a new login code (Q160) for a pending login. The new code gets a
   * new ticket; the old ticket stops working. The ticket keeps the expiry
   * of the original password check.
   */
  async function resendLoginCode(
    input: { loginTicket: string },
    meta: RequestMeta,
  ): Promise<LoginTicket> {
    const now = clock.now();
    const { challenge, account } = await challengeForTicket(input.loginTicket, now);
    if (!isActiveEmployee(account)) {
      throw accountNotActive();
    }
    await claimSend("EMPLOYEE_LOGIN", account.email, meta, now);
    const loginTicketExpiresAt = challenge.grantExpiresAt as Date;
    const { issued, loginTicket } = await issueLoginCode(
      account,
      loginTicketExpiresAt,
      meta,
      now,
      challenge,
    );
    await sendEmployeeCode("EMPLOYEE_LOGIN", account.id, issued, meta);
    return { loginTicket, loginTicketExpiresAt, cooldownSeconds: COOLDOWN_SECONDS };
  }

  /**
   * Refresh-token rotation with reuse detection (ADR-0013). The session keeps
   * its absolute expiry; an idle session (R29) cannot be refreshed, and a
   * refresh is not activity.
   */
  async function refresh(refreshToken: string, meta: RequestMeta): Promise<EmployeeSignedIn> {
    const now = clock.now();
    if (!isWellFormedToken("refresh", refreshToken)) {
      throw unauthenticated();
    }
    const settings = await getSettings();

    type Outcome =
      | { kind: "ok"; result: EmployeeSignedIn }
      | { kind: "invalid" }
      | { kind: "blocked" }
      | { kind: "reuse"; sessionId: string; accountId: string };

    const outcome = await runInTransaction<Outcome>(
      async (tx) => {
        const row = await tx.authSessionToken.findUnique({
          where: { refreshTokenHash: hashToken(refreshToken) },
          include: { session: { include: { account: { include: { employee: true } } } } },
        });
        if (!row) {
          return { kind: "invalid" };
        }
        const { session } = row;
        if (session.revokedAt !== null || session.expiresAt <= now) {
          return { kind: "invalid" };
        }
        if (row.rotatedAt !== null) {
          if (now.getTime() - row.rotatedAt.getTime() <= AUTH_POLICY.refreshReuseGraceMs) {
            return { kind: "invalid" };
          }
          await revokeSession(tx, session.id, "REUSE_DETECTED", now);
          return { kind: "reuse", sessionId: session.id, accountId: session.accountId };
        }
        if (session.domain !== "EMPLOYEE") {
          return { kind: "blocked" };
        }
        if (isIdle(session.lastUsedAt, now, settings)) {
          return { kind: "invalid" };
        }
        if (!isActiveEmployee(session.account)) {
          return { kind: "blocked" };
        }
        const claimed = await tx.authSessionToken.updateMany({
          where: { id: row.id, rotatedAt: null },
          data: { rotatedAt: now },
        });
        if (claimed.count === 0) {
          return { kind: "invalid" };
        }
        const tokens = await issueTokenPair(tx, session, now);
        return {
          kind: "ok",
          result: {
            view: toView(session.account),
            session: sessionInfo(session.expiresAt, settings),
            tokens,
          },
        };
      },
      {},
      db,
    );

    switch (outcome.kind) {
      case "ok":
        return outcome.result;
      case "reuse":
        meta.logger.warn("employee refresh token reuse detected; session revoked", {
          accountId: outcome.accountId,
          sessionId: outcome.sessionId,
        });
        throw unauthenticated();
      case "blocked":
        throw accountNotActive();
      case "invalid":
        throw unauthenticated();
    }
  }

  /**
   * Validates an employee access token. A customer session is FORBIDDEN here
   * (separate domains, R15); an idle session (R29) is UNAUTHENTICATED. Every
   * accepted request is activity (recorded at most once a minute).
   */
  async function authenticate(accessToken: string): Promise<EmployeePrincipal> {
    const now = clock.now();
    if (!isWellFormedToken("access", accessToken)) {
      throw unauthenticated();
    }
    const row = await db.authSessionToken.findUnique({
      where: { accessTokenHash: hashToken(accessToken) },
      include: { session: { include: { account: { include: { employee: true } } } } },
    });
    if (
      !row ||
      row.rotatedAt !== null ||
      row.accessExpiresAt <= now ||
      row.session.revokedAt !== null ||
      row.session.expiresAt <= now
    ) {
      throw unauthenticated();
    }
    const { session } = row;
    if (session.domain !== "EMPLOYEE") {
      throw new AppError("FORBIDDEN", "This token cannot be used here.");
    }
    const settings = await getSettings();
    if (isIdle(session.lastUsedAt, now, settings)) {
      throw unauthenticated();
    }
    if (!isActiveEmployee(session.account)) {
      throw accountNotActive();
    }

    if (now.getTime() - session.lastUsedAt.getTime() >= AUTH_POLICY.lastUsedWriteIntervalMs) {
      await db.authSession.updateMany({
        where: {
          id: session.id,
          lastUsedAt: { lt: new Date(now.getTime() - AUTH_POLICY.lastUsedWriteIntervalMs) },
        },
        data: { lastUsedAt: now },
      });
    }

    return {
      accountId: session.accountId,
      employeeId: session.account.employee.id,
      sessionId: session.id,
      session: sessionInfo(session.expiresAt, settings),
      view: toView(session.account),
    };
  }

  async function logout(principal: EmployeePrincipal, meta: RequestMeta): Promise<void> {
    await revokeSession(db, principal.sessionId, "LOGOUT", clock.now());
    meta.logger.info("employee logged out", {
      accountId: principal.accountId,
      sessionId: principal.sessionId,
    });
  }

  /** Revokes every session of the employee, including the current one. */
  async function logoutAll(principal: EmployeePrincipal, meta: RequestMeta): Promise<void> {
    const revoked = await revokeAccountSessions(db, principal.accountId, "LOGOUT_ALL", clock.now());
    meta.logger.info("employee logged out of all sessions", {
      accountId: principal.accountId,
      revokedSessions: revoked,
    });
  }

  /**
   * Emails a password-reset code to an active employee. Same answer whether
   * or not the email belongs to one (ADR-0014).
   */
  async function forgotPassword(
    input: { email: string },
    meta: RequestMeta,
  ): Promise<{ cooldownSeconds: number }> {
    const now = clock.now();
    await claimSend("PASSWORD_RESET", input.email, meta, now);
    const account = await findEmployeeAccount(input.email);
    if (!account || !isActiveEmployee(account)) {
      meta.logger.info("employee password reset requested for no eligible account");
      return { cooldownSeconds: COOLDOWN_SECONDS };
    }
    const issued = await issueOtpChallenge(
      db,
      { accountId: account.id, purpose: "PASSWORD_RESET", destination: account.email, ip: meta.ip },
      now,
    );
    await sendEmployeeCode("PASSWORD_RESET", account.id, issued, meta);
    return { cooldownSeconds: COOLDOWN_SECONDS };
  }

  /**
   * Sets a new password with the emailed reset code and revokes every session
   * of the employee on every device (R29). It does not sign the employee in.
   */
  async function resetPassword(
    input: { email: string; code: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const now = clock.now();
    const verifyIpKey = ipKey("otp:verify", meta.ip);
    await assertNotBlocked([verifyIpKey], now);
    const fail = async (error: AppError): Promise<never> => {
      await recordHit(db, verifyIpKey, OTP_VERIFY_IP_LIMIT, now);
      meta.logger.warn("employee password reset code rejected", { reason: error.code });
      throw error;
    };

    const account = await findEmployeeAccount(input.email);
    const challenge = account
      ? await db.otpChallenge.findFirst({
          where: {
            accountId: account.id,
            purpose: "PASSWORD_RESET",
            supersededAt: null,
            consumedAt: null,
          },
          orderBy: { createdAt: "desc" },
        })
      : null;
    if (!account || !challenge) {
      return fail(invalidCode());
    }
    if (challenge.expiresAt <= now) {
      return fail(expiredCode());
    }
    const attempt = await attemptOtpCode(db, challenge, input.code, now);
    if (!attempt.ok) {
      return fail(
        invalidCode(
          attempt.attemptsRemaining === undefined
            ? {}
            : { attemptsRemaining: attempt.attemptsRemaining },
        ),
      );
    }
    if (!isActiveEmployee(account)) {
      throw accountNotActive();
    }

    const passwordHash = await hasher.hash(input.newPassword);
    const revoked = await runInTransaction(
      async (tx) => {
        await tx.account.update({
          where: { id: account.id },
          data: { passwordHash, passwordChangedAt: now },
        });
        return revokeAccountSessions(tx, account.id, "PASSWORD_RESET", now);
      },
      {},
      db,
    );
    meta.logger.info("employee password reset; all sessions revoked", {
      accountId: account.id,
      revokedCount: revoked,
    });
  }

  return {
    login,
    verifyLoginCode,
    resendLoginCode,
    refresh,
    authenticate,
    logout,
    logoutAll,
    forgotPassword,
    resetPassword,
  };
}

export type EmployeeAuthService = ReturnType<typeof createEmployeeAuthService>;

let defaultService: EmployeeAuthService | undefined;

/** The process-wide service used by route handlers. */
export function getEmployeeAuthService(): EmployeeAuthService {
  defaultService ??= createEmployeeAuthService({
    db: getDb(),
    clock: systemClock,
    hasher: createScryptHasher(),
    sessionSettings: () => readStaffSessionSettings(getDb()),
  });
  return defaultService;
}
