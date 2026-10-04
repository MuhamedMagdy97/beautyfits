import { createHash } from "node:crypto";
import type { Account, Customer, Locale, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { getEmailSender, type EmailSender } from "@/server/email/email";
import { AppError } from "@/server/errors/app-error";
import type { Logger } from "@/server/logging/logger";
import {
  claimOtpSend,
  deliverOtpEmail,
  issueOtpChallenge,
  type IssuedOtp,
} from "@/server/modules/auth/otp";
import { createScryptHasher, type PasswordHasher } from "@/server/modules/auth/password-hash";
import {
  AUTH_POLICY,
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_IP_LIMIT,
  REGISTER_IP_LIMIT,
} from "@/server/modules/auth/policy";
import {
  createSession,
  issueTokenPair,
  revokeAccountSessions,
  revokeSession,
  type SessionMeta,
} from "@/server/modules/auth/sessions";
import { hashToken, isWellFormedToken } from "@/server/modules/auth/tokens";
import type { IssuedTokens } from "@/server/modules/auth/transport";
import {
  getBlockedUntil,
  recordHit,
  resetBucket,
  secondsUntil,
} from "@/server/rate-limit/rate-limit";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Customer authentication core (TASK-007): registration, login, refresh,
 * logout, logout-all, password change and access-token validation.
 *
 * Business rules: Q151, Q156, Q162, Q164, R13, R15, R23–R27 and the owner
 * answers recorded in docs/tasks/TASK-007-customer-auth-core.md.
 * Technical design: ADR-0008, ADR-0013.
 */

export interface RequestMeta extends SessionMeta {
  logger: Logger;
  /** The API request id; recorded as the correlation id of audit entries. */
  requestId?: string;
}

export interface AccountView {
  account: {
    id: string;
    email: string;
    status: Account["status"];
    emailVerified: boolean;
    phoneVerified: boolean;
  };
  customer: {
    id: string;
    fullName: string;
    phone: string;
    preferredLocale: Locale;
    /** `YYYY-MM-DD` or null (TASK-009). */
    dateOfBirth: string | null;
  };
}

export interface CustomerPrincipal {
  accountId: string;
  customerId: string;
  sessionId: string;
  sessionExpiresAt: Date;
  view: AccountView;
}

export interface SignedIn {
  view: AccountView;
  sessionExpiresAt: Date;
  tokens: IssuedTokens;
}

export interface RegisterInput {
  /** Normalized (trimmed, lowercased). */
  email: string;
  password: string;
  /** Normalized E.164 Egyptian mobile (R27). */
  phone: string;
  fullName: string;
  preferredLocale: Locale;
}

export interface Registered {
  accountId: string;
  customerId: string;
  status: Account["status"];
  emailVerified: boolean;
  phoneVerified: boolean;
  /** The pending account expires at this time unless the email is verified (TASK-008). */
  pendingExpiresAt: Date;
  /**
   * Whether an email verification code was sent. False when the email's code
   * limits are reached (60 s cooldown, 5 per hour); the client offers resend.
   */
  verificationCodeSent: boolean;
}

export interface AuthServiceDeps {
  db: PrismaClient;
  clock: Clock;
  hasher: PasswordHasher;
  /** Defaults to the configured sender (ADR-0014). */
  email?: EmailSender;
}

export type AccountWithCustomer = Account & { customer: Customer | null };

const RATE_LIMITED_MESSAGE = "Too many attempts. Try again later.";

function rateLimited(until: Date, now: Date): AppError {
  return new AppError("AUTH_RATE_LIMITED", RATE_LIMITED_MESSAGE, {
    details: { retryAfterSeconds: secondsUntil(until, now) },
  });
}

function unauthenticated(): AppError {
  return new AppError("UNAUTHENTICATED", "Authentication required. Sign in again.");
}

function accountNotActive(): AppError {
  return new AppError("FORBIDDEN", "This account is not active.");
}

/** Counter keys never contain the raw email. */
export function loginAccountKey(email: string): string {
  return `login:account:${createHash("sha256").update(email).digest("hex")}`;
}

function ipKey(prefix: string, ip: string | null): string {
  return `${prefix}:ip:${ip ?? "unknown"}`;
}

export function isPendingExpired(
  account: Pick<Account, "status" | "createdAt">,
  now: Date,
): boolean {
  return (
    account.status === "PENDING_VERIFICATION" &&
    account.createdAt.getTime() + AUTH_POLICY.pendingAccountTtlMs <= now.getTime()
  );
}

export function toView(account: AccountWithCustomer): AccountView {
  const customer = account.customer;
  if (!customer) {
    // Every customer account is created with its profile in one transaction.
    throw new Error(`Customer account ${account.id} has no customer profile`);
  }
  return {
    account: {
      id: account.id,
      email: account.email,
      status: account.status,
      emailVerified: account.emailVerifiedAt !== null,
      phoneVerified: customer.phoneVerifiedAt !== null,
    },
    customer: {
      id: customer.id,
      fullName: customer.fullName,
      phone: customer.phone,
      preferredLocale: customer.preferredLocale,
      dateOfBirth: customer.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    },
  };
}

/**
 * Outcome of the account checks shared by refresh and access validation:
 * SUSPENDED/DEACTIVATED → FORBIDDEN; an expired pending account no longer
 * exists → UNAUTHENTICATED; a pending account has limited access.
 */
function accountAccess(
  account: AccountWithCustomer,
  now: Date,
): "active" | "pending" | "gone" | "blocked" {
  if (account.accountType !== "CUSTOMER") {
    return "blocked";
  }
  switch (account.status) {
    case "ACTIVE":
      return "active";
    case "PENDING_VERIFICATION":
      return isPendingExpired(account, now) ? "gone" : "pending";
    default:
      return "blocked";
  }
}

export function createAuthService(deps: AuthServiceDeps) {
  const { db, clock, hasher } = deps;
  const emailSender = deps.email ?? getEmailSender();

  async function assertNotBlocked(keys: string[], now: Date): Promise<void> {
    for (const key of keys) {
      const until = await getBlockedUntil(db, key, now);
      if (until) {
        throw rateLimited(until, now);
      }
    }
  }

  /**
   * Registration (User Flows §3.1): creates a PENDING_VERIFICATION account.
   * Only verified identifiers are reserved; a fully unverified pending account
   * (or any expired pending account) using the same email or phone is
   * replaced. The email verification code is sent after commit (TASK-008).
   */
  async function register(input: RegisterInput, meta: RequestMeta): Promise<Registered> {
    const now = clock.now();
    const registerIpKey = ipKey("register", meta.ip);
    await assertNotBlocked([registerIpKey], now);
    await recordHit(db, registerIpKey, REGISTER_IP_LIMIT, now);

    const passwordHash = await hasher.hash(input.password);
    // Q42: registration sends the email verification code, within the email's send limits.
    const sendClaim = await claimOtpSend(db, "EMAIL_VERIFICATION", input.email, now);

    const { account, replaced, otp } = await runInTransaction(
      async (tx) => {
        // Serialize registrations for the same email / phone.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`register:email:${input.email}`}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`register:phone:${input.phone}`}))`;

        const byEmail = await tx.account.findMany({
          where: { accountType: "CUSTOMER", email: input.email },
          include: { customer: true },
        });
        const byPhone = await tx.account.findMany({
          where: { accountType: "CUSTOMER", customer: { phone: input.phone } },
          include: { customer: true },
        });

        const toReplace = new Set<string>();
        const candidates = new Map<string, AccountWithCustomer>();
        for (const candidate of [...byEmail, ...byPhone]) {
          candidates.set(candidate.id, candidate);
        }
        for (const candidate of candidates.values()) {
          if (isPendingExpired(candidate, now)) {
            toReplace.add(candidate.id);
            continue;
          }
          const sameEmail = candidate.email === input.email;
          const samePhone = candidate.customer?.phone === input.phone;
          if (sameEmail && candidate.emailVerifiedAt !== null) {
            throw new AppError(
              "CONFLICT",
              "An account with this email already exists. Log in or recover your password.",
              { details: { field: "email" } },
            );
          }
          if (samePhone && candidate.customer?.phoneVerifiedAt) {
            throw new AppError("CONFLICT", "An account with this phone number already exists.", {
              details: { field: "phone" },
            });
          }
          const fullyUnverified =
            candidate.status === "PENDING_VERIFICATION" &&
            candidate.emailVerifiedAt === null &&
            !candidate.customer?.phoneVerifiedAt;
          if (fullyUnverified) {
            toReplace.add(candidate.id);
          }
          // Otherwise (a half-verified pending account sharing only the
          // unverified identifier) both accounts coexist; the first to verify
          // the identifier keeps it (partial unique indexes).
        }

        if (toReplace.size > 0) {
          // Pending accounts cannot place orders or hold any business history,
          // so replacing them removes only authentication data.
          const ids = [...toReplace];
          await tx.authSession.deleteMany({ where: { accountId: { in: ids } } });
          await tx.customer.deleteMany({ where: { accountId: { in: ids } } });
          await tx.account.deleteMany({ where: { id: { in: ids } } });
        }

        const created = await tx.account.create({
          data: {
            accountType: "CUSTOMER",
            email: input.email,
            passwordHash,
            passwordChangedAt: now,
            status: "PENDING_VERIFICATION",
            createdAt: now,
            customer: {
              create: {
                phone: input.phone,
                fullName: input.fullName,
                preferredLocale: input.preferredLocale,
                createdAt: now,
              },
            },
          },
          include: { customer: true },
        });
        let otp: IssuedOtp | null = null;
        if (sendClaim.allowed) {
          otp = await issueOtpChallenge(
            tx,
            {
              accountId: created.id,
              purpose: "EMAIL_VERIFICATION",
              destination: input.email,
              ip: meta.ip,
            },
            now,
          );
        }
        return { account: created, replaced: toReplace.size, otp };
      },
      {},
      db,
    );

    meta.logger.info("customer registered", { accountId: account.id, replacedPending: replaced });
    // After commit: a failed send never undoes the registration (ADR-0014).
    const verificationCodeSent = otp
      ? await deliverOtpEmail(
          emailSender,
          meta.logger,
          "EMAIL_VERIFICATION",
          { accountId: account.id, locale: account.customer?.preferredLocale ?? "ar" },
          otp,
        )
      : false;
    const view = toView(account);
    return {
      accountId: account.id,
      customerId: view.customer.id,
      status: account.status,
      emailVerified: false,
      phoneVerified: false,
      pendingExpiresAt: new Date(now.getTime() + AUTH_POLICY.pendingAccountTtlMs),
      verificationCodeSent,
    };
  }

  /**
   * Login with email + password (R13). Throttled per email (R24: 5
   * consecutive failures → 15-minute block) and per IP. Unknown email and
   * wrong password give the same answer after the same work. An unverified
   * email is revealed only after a correct password (R26).
   */
  async function login(
    input: { email: string; password: string },
    meta: RequestMeta,
  ): Promise<SignedIn> {
    const now = clock.now();
    const accountKey = loginAccountKey(input.email);
    const loginIpKey = ipKey("login", meta.ip);
    await assertNotBlocked([accountKey, loginIpKey], now);

    const candidates = await db.account.findMany({
      where: { accountType: "CUSTOMER", email: input.email },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });
    const live = candidates.filter((candidate) => !isPendingExpired(candidate, now));
    const account = live.find((candidate) => candidate.emailVerifiedAt !== null) ?? live[0] ?? null;

    let passwordOk = false;
    if (account) {
      passwordOk = await hasher.verify(input.password, account.passwordHash);
    } else {
      await hasher.verifyDummy(input.password);
    }

    if (!account || !passwordOk) {
      const accountState = await recordHit(db, accountKey, LOGIN_ACCOUNT_LIMIT, now);
      const ipState = await recordHit(db, loginIpKey, LOGIN_IP_LIMIT, now);
      meta.logger.warn("customer login failed", { accountId: account?.id ?? null });
      if (accountState.blockedUntil && accountState.count >= LOGIN_ACCOUNT_LIMIT.limit) {
        meta.logger.warn("customer login locked after repeated failures", {
          accountId: account?.id ?? null,
        });
      }
      if (ipState.blockedUntil && ipState.count >= LOGIN_IP_LIMIT.limit) {
        meta.logger.warn("login blocked for client IP after repeated failures");
      }
      throw new AppError("AUTH_INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    await resetBucket(db, accountKey);

    if (account.status === "SUSPENDED" || account.status === "DEACTIVATED") {
      throw accountNotActive();
    }
    if (account.emailVerifiedAt === null) {
      throw new AppError("AUTH_EMAIL_NOT_VERIFIED", "Verify your email address before logging in.");
    }

    const session = await runInTransaction(
      async (tx) => {
        const created = await createSession(
          tx,
          { accountId: account.id, domain: "CUSTOMER", ttlMs: AUTH_POLICY.customerSessionTtlMs },
          meta,
          now,
        );
        await tx.account.update({ where: { id: account.id }, data: { lastLoginAt: now } });
        return created;
      },
      {},
      db,
    );

    meta.logger.info("customer logged in", { accountId: account.id, sessionId: session.sessionId });
    return { view: toView(account), sessionExpiresAt: session.expiresAt, tokens: session.tokens };
  }

  /**
   * Refresh-token rotation with reuse detection (ADR-0013). The session keeps
   * its absolute expiry (Q162, owner answer).
   */
  async function refresh(refreshToken: string, meta: RequestMeta): Promise<SignedIn> {
    const now = clock.now();
    if (!isWellFormedToken("refresh", refreshToken)) {
      throw unauthenticated();
    }

    type Outcome =
      | { kind: "ok"; result: SignedIn }
      | { kind: "invalid" }
      | { kind: "blocked" }
      | { kind: "reuse"; sessionId: string; accountId: string };

    const outcome = await runInTransaction<Outcome>(
      async (tx) => {
        const row = await tx.authSessionToken.findUnique({
          where: { refreshTokenHash: hashToken(refreshToken) },
          include: { session: { include: { account: { include: { customer: true } } } } },
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
        if (session.domain !== "CUSTOMER") {
          return { kind: "blocked" };
        }
        const access = accountAccess(session.account, now);
        if (access === "gone") {
          return { kind: "invalid" };
        }
        if (access === "blocked") {
          return { kind: "blocked" };
        }

        // Claim the pair; a concurrent refresh with the same token loses here.
        const claimed = await tx.authSessionToken.updateMany({
          where: { id: row.id, rotatedAt: null },
          data: { rotatedAt: now },
        });
        if (claimed.count === 0) {
          return { kind: "invalid" };
        }
        const tokens = await issueTokenPair(tx, session, now);
        await tx.authSession.update({ where: { id: session.id }, data: { lastUsedAt: now } });
        return {
          kind: "ok",
          result: { view: toView(session.account), sessionExpiresAt: session.expiresAt, tokens },
        };
      },
      {},
      db,
    );

    switch (outcome.kind) {
      case "ok":
        return outcome.result;
      case "reuse":
        meta.logger.warn("refresh token reuse detected; session revoked", {
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
   * Validates an access token (every authenticated request, ADR-0008).
   * `allowPending` admits a PENDING_VERIFICATION account (verified email,
   * phone not yet verified); other customer endpoints require ACTIVE.
   */
  async function authenticate(
    accessToken: string,
    options: { allowPending?: boolean } = {},
  ): Promise<CustomerPrincipal> {
    const now = clock.now();
    if (!isWellFormedToken("access", accessToken)) {
      throw unauthenticated();
    }
    const row = await db.authSessionToken.findUnique({
      where: { accessTokenHash: hashToken(accessToken) },
      include: { session: { include: { account: { include: { customer: true } } } } },
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
    if (session.domain !== "CUSTOMER") {
      throw new AppError("FORBIDDEN", "This token cannot be used here.");
    }
    const access = accountAccess(session.account, now);
    if (access === "gone") {
      throw unauthenticated();
    }
    if (access === "blocked") {
      throw accountNotActive();
    }
    if (access === "pending" && !options.allowPending) {
      throw new AppError("FORBIDDEN", "Complete account verification to continue.", {
        details: { reason: "ACCOUNT_PENDING_VERIFICATION" },
      });
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

    const view = toView(session.account);
    return {
      accountId: session.accountId,
      customerId: view.customer.id,
      sessionId: session.id,
      sessionExpiresAt: session.expiresAt,
      view,
    };
  }

  async function logout(principal: CustomerPrincipal, meta: RequestMeta): Promise<void> {
    await revokeSession(db, principal.sessionId, "LOGOUT", clock.now());
    meta.logger.info("customer logged out", {
      accountId: principal.accountId,
      sessionId: principal.sessionId,
    });
  }

  /** Q164: revokes every session of the customer, including the current one. */
  async function logoutAll(principal: CustomerPrincipal, meta: RequestMeta): Promise<void> {
    const revoked = await revokeAccountSessions(db, principal.accountId, "LOGOUT_ALL", clock.now());
    meta.logger.info("customer logged out of all sessions", {
      accountId: principal.accountId,
      revokedSessions: revoked,
    });
  }

  /**
   * Password change while logged in (R23): keeps the current session and
   * revokes all others. Wrong current passwords count toward the R24 lockout.
   */
  async function changePassword(
    principal: CustomerPrincipal,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<void> {
    const now = clock.now();
    const accountKey = loginAccountKey(principal.view.account.email);
    await assertNotBlocked([accountKey], now);

    const account = await db.account.findUniqueOrThrow({ where: { id: principal.accountId } });
    if (!(await hasher.verify(input.currentPassword, account.passwordHash))) {
      await recordHit(db, accountKey, LOGIN_ACCOUNT_LIMIT, now);
      meta.logger.warn("customer password change rejected: wrong current password", {
        accountId: account.id,
      });
      throw new AppError("AUTH_INVALID_CREDENTIALS", "Current password is incorrect.");
    }
    await resetBucket(db, accountKey);

    const passwordHash = await hasher.hash(input.newPassword);
    const revoked = await runInTransaction(
      async (tx: Db) => {
        await tx.account.update({
          where: { id: account.id },
          data: { passwordHash, passwordChangedAt: now },
        });
        return revokeAccountSessions(tx, account.id, "PASSWORD_CHANGE", now, {
          exceptSessionId: principal.sessionId,
        });
      },
      {},
      db,
    );
    meta.logger.info("customer password changed", {
      accountId: account.id,
      revokedSessions: revoked,
    });
  }

  return { register, login, refresh, authenticate, logout, logoutAll, changePassword };
}

export type AuthService = ReturnType<typeof createAuthService>;

let defaultService: AuthService | undefined;

/** The process-wide service used by route handlers. */
export function getAuthService(): AuthService {
  defaultService ??= createAuthService({
    db: getDb(),
    clock: systemClock,
    hasher: createScryptHasher(),
  });
  return defaultService;
}
