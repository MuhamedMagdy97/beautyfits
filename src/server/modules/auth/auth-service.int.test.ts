import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { AppError, type ErrorCode } from "@/server/errors/app-error";
import { createLogger } from "@/server/logging/logger";
import { createAuthService, type RequestMeta } from "@/server/modules/auth/auth-service";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import { createSession } from "@/server/modules/auth/sessions";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

const db = getDb();
const START = new Date("2026-09-30T10:00:00.000Z").getTime();
let nowMs = START;
const clock = { now: () => new Date(nowMs) };
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 });
const service = createAuthService({ db, clock, hasher });
const silent = createLogger({ level: "error", write: () => {} });

const PASSWORD = "teal lantern over the nile";
const NEW_PASSWORD = "violet kettle on the balcony";

function meta(ip: string | null = "203.0.113.7"): RequestMeta {
  return { ip, userAgent: "vitest", logger: silent };
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

let sequence = 0;
function identity(overrides: { email?: string; phone?: string } = {}) {
  sequence += 1;
  return {
    email: overrides.email ?? `customer${sequence}@example.com`,
    phone: overrides.phone ?? `+2010${String(10_000_000 + sequence).slice(-8)}`,
    password: PASSWORD,
    fullName: "Sara Ali",
    preferredLocale: "ar" as const,
  };
}

async function register(overrides: { email?: string; phone?: string } = {}) {
  return service.register(identity(overrides), meta());
}

async function verify(accountId: string, what: { email?: boolean; phone?: boolean }) {
  if (what.email) {
    await db.account.update({ where: { id: accountId }, data: { emailVerifiedAt: clock.now() } });
  }
  if (what.phone) {
    await db.customer.update({ where: { accountId }, data: { phoneVerifiedAt: clock.now() } });
  }
  if (what.email && what.phone) {
    await db.account.update({ where: { id: accountId }, data: { status: "ACTIVE" } });
  }
}

/** A registered, fully verified (ACTIVE) customer. */
async function activeCustomer(overrides: { email?: string; phone?: string } = {}) {
  const registered = await register(overrides);
  await verify(registered.accountId, { email: true, phone: true });
  const email =
    overrides.email ??
    (await db.account.findUniqueOrThrow({ where: { id: registered.accountId } })).email;
  return { ...registered, email };
}

beforeEach(async () => {
  await resetDatabase();
  nowMs = START;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("register", () => {
  it("creates a PENDING_VERIFICATION account with a hashed password", async () => {
    const registered = await register({ email: "sara@example.com", phone: "+201012345678" });
    expect(registered).toMatchObject({
      status: "PENDING_VERIFICATION",
      emailVerified: false,
      phoneVerified: false,
      pendingExpiresAt: new Date(START + 24 * MS_PER_HOUR),
    });
    const account = await db.account.findUniqueOrThrow({
      where: { id: registered.accountId },
      include: { customer: true },
    });
    expect(account.email).toBe("sara@example.com");
    expect(account.passwordHash).toMatch(/^scrypt\$/);
    expect(account.passwordHash).not.toContain(PASSWORD);
    expect(account.customer).toMatchObject({ phone: "+201012345678", fullName: "Sara Ali" });
  });

  it("rejects an email that is verified on another account (Q151)", async () => {
    const first = await register({ email: "sara@example.com" });
    await verify(first.accountId, { email: true });
    const error = await expectCode(register({ email: "sara@example.com" }), "CONFLICT");
    expect(error.details).toEqual({ field: "email" });
  });

  it("rejects a phone that is verified on another account", async () => {
    const first = await register({ phone: "+201112345678" });
    await verify(first.accountId, { phone: true });
    const error = await expectCode(register({ phone: "+201112345678" }), "CONFLICT");
    expect(error.details).toEqual({ field: "phone" });
  });

  it("replaces a fully unverified pending account with the same email or phone", async () => {
    const byEmail = await register({ email: "sara@example.com" });
    const byPhone = await register({ phone: "+201212345678" });
    const replacement = await register({ email: "sara@example.com", phone: "+201212345678" });

    const ids = (await db.account.findMany({ select: { id: true } })).map((a) => a.id);
    expect(ids).toEqual([replacement.accountId]);
    expect(ids).not.toContain(byEmail.accountId);
    expect(ids).not.toContain(byPhone.accountId);
    expect(await db.customer.count()).toBe(1);
  });

  it("lets a half-verified pending account and a new registration share an unverified phone", async () => {
    const halfVerified = await register({ email: "first@example.com", phone: "+201512345678" });
    await verify(halfVerified.accountId, { email: true });
    const second = await register({ email: "second@example.com", phone: "+201512345678" });

    expect(await db.account.count()).toBe(2);
    // The first to verify the phone keeps it; the second cannot verify it too.
    await verify(halfVerified.accountId, { phone: true });
    await expect(verify(second.accountId, { phone: true })).rejects.toThrow();
  });

  it("replaces an expired pending account even when its email was verified", async () => {
    const old = await register({ email: "sara@example.com" });
    await verify(old.accountId, { email: true });
    await createSession(
      db,
      { accountId: old.accountId, domain: "CUSTOMER", ttlMs: 30 * MS_PER_DAY },
      meta(),
      clock.now(),
    );
    advance(24 * MS_PER_HOUR);

    const replacement = await register({ email: "sara@example.com" });
    const accounts = await db.account.findMany({ select: { id: true } });
    expect(accounts.map((a) => a.id)).toEqual([replacement.accountId]);
    expect(await db.authSession.count()).toBe(0);
  });

  it("keeps customer and employee identities separate (R15)", async () => {
    await db.account.create({
      data: {
        accountType: "EMPLOYEE",
        email: "sara@example.com",
        emailVerifiedAt: clock.now(),
        passwordHash: "scrypt$N=1024,r=8,p=1$c2FsdA$aGFzaA",
        status: "ACTIVE",
      },
    });
    await expect(register({ email: "sara@example.com" })).resolves.toBeDefined();
  });

  it("limits registrations per IP to 10 per hour", async () => {
    for (let i = 0; i < 10; i++) {
      await register();
    }
    const error = await expectCode(register(), "AUTH_RATE_LIMITED");
    expect(error.details.retryAfterSeconds).toBe(3600);
    await expect(service.register(identity(), meta("198.51.100.20"))).resolves.toBeDefined();
    advance(MS_PER_HOUR);
    await expect(register()).resolves.toBeDefined();
  });
});

describe("login", () => {
  it("returns tokens for an active customer and records the login", async () => {
    const customer = await activeCustomer({ email: "sara@example.com" });
    const signedIn = await service.login({ email: "sara@example.com", password: PASSWORD }, meta());
    expect(signedIn.view.account).toEqual({
      id: customer.accountId,
      email: "sara@example.com",
      status: "ACTIVE",
      emailVerified: true,
      phoneVerified: true,
    });
    expect(signedIn.tokens.accessToken).toMatch(/^bfa_/);
    expect(signedIn.tokens.refreshToken).toMatch(/^bfr_/);
    expect(signedIn.tokens.accessTokenExpiresAt).toEqual(new Date(START + 15 * MS_PER_MINUTE));
    expect(signedIn.sessionExpiresAt).toEqual(new Date(START + 30 * MS_PER_DAY));

    const session = await db.authSession.findFirstOrThrow({ include: { tokens: true } });
    expect(session).toMatchObject({ domain: "CUSTOMER", ipAddress: "203.0.113.7" });
    // Only hashes are stored.
    expect(session.tokens[0].accessTokenHash).not.toBe(signedIn.tokens.accessToken);
    expect(session.tokens[0].accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const account = await db.account.findUniqueOrThrow({ where: { id: customer.accountId } });
    expect(account.lastLoginAt).toEqual(clock.now());
  });

  it("gives the same error for an unknown email and a wrong password", async () => {
    await activeCustomer({ email: "sara@example.com" });
    const unknown = await expectCode(
      service.login({ email: "nobody@example.com", password: PASSWORD }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
    const wrong = await expectCode(
      service.login({ email: "sara@example.com", password: "wrong password here" }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
    expect(unknown.message).toBe(wrong.message);
  });

  it("refuses an unverified email only after a correct password (R26)", async () => {
    await register({ email: "sara@example.com" });
    await expectCode(
      service.login({ email: "sara@example.com", password: "wrong password here" }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
    await expectCode(
      service.login({ email: "sara@example.com", password: PASSWORD }, meta()),
      "AUTH_EMAIL_NOT_VERIFIED",
    );
  });

  it("lets a half-verified customer in with limited access", async () => {
    const registered = await register({ email: "sara@example.com" });
    await verify(registered.accountId, { email: true });
    const signedIn = await service.login({ email: "sara@example.com", password: PASSWORD }, meta());
    expect(signedIn.view.account.status).toBe("PENDING_VERIFICATION");

    const token = signedIn.tokens.accessToken;
    await expect(service.authenticate(token, { allowPending: true })).resolves.toMatchObject({
      accountId: registered.accountId,
    });
    const error = await expectCode(service.authenticate(token), "FORBIDDEN");
    expect(error.details).toEqual({ reason: "ACCOUNT_PENDING_VERIFICATION" });

    // The pending account expires 24 hours after registration.
    advance(24 * MS_PER_HOUR);
    await expectCode(service.authenticate(token, { allowPending: true }), "UNAUTHENTICATED");
    await expectCode(
      service.login({ email: "sara@example.com", password: PASSWORD }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
  });

  it("refuses suspended and deactivated accounts", async () => {
    const customer = await activeCustomer({ email: "sara@example.com" });
    for (const status of ["SUSPENDED", "DEACTIVATED"] as const) {
      await db.account.update({ where: { id: customer.accountId }, data: { status } });
      await expectCode(
        service.login({ email: "sara@example.com", password: PASSWORD }, meta()),
        "FORBIDDEN",
      );
    }
  });
});

describe("login throttling (R24)", () => {
  const wrong = (email = "sara@example.com", ip?: string) =>
    service.login({ email, password: "wrong password here" }, meta(ip));
  const right = (ip?: string) =>
    service.login({ email: "sara@example.com", password: PASSWORD }, meta(ip));

  it("blocks the account for 15 minutes after 5 consecutive failures, even with the right password", async () => {
    await activeCustomer({ email: "sara@example.com" });
    for (let i = 0; i < 5; i++) {
      await expectCode(wrong(), "AUTH_INVALID_CREDENTIALS");
    }
    const error = await expectCode(right(), "AUTH_RATE_LIMITED");
    expect(error.details.retryAfterSeconds).toBe(15 * 60);
    // The block is per account, not per IP.
    await expectCode(right("198.51.100.9"), "AUTH_RATE_LIMITED");

    advance(15 * MS_PER_MINUTE);
    await expect(right()).resolves.toBeDefined();
  });

  it("counts consecutive failures: a successful login resets the counter", async () => {
    await activeCustomer({ email: "sara@example.com" });
    for (let i = 0; i < 4; i++) {
      await expectCode(wrong(), "AUTH_INVALID_CREDENTIALS");
    }
    await right();
    for (let i = 0; i < 4; i++) {
      await expectCode(wrong(), "AUTH_INVALID_CREDENTIALS");
    }
    await expect(right()).resolves.toBeDefined();
  });

  it("starts a new count after the block ends", async () => {
    await activeCustomer({ email: "sara@example.com" });
    for (let i = 0; i < 5; i++) {
      await expectCode(wrong(), "AUTH_INVALID_CREDENTIALS");
    }
    advance(15 * MS_PER_MINUTE);
    await expectCode(wrong(), "AUTH_INVALID_CREDENTIALS");
    await expect(right()).resolves.toBeDefined();
  });

  it("also locks unknown emails, so lockouts do not reveal registered emails", async () => {
    for (let i = 0; i < 5; i++) {
      await expectCode(wrong("nobody@example.com"), "AUTH_INVALID_CREDENTIALS");
    }
    await expectCode(wrong("nobody@example.com"), "AUTH_RATE_LIMITED");
  });

  it("blocks an IP after 30 failed logins in 15 minutes", async () => {
    await activeCustomer({ email: "sara@example.com" });
    for (let i = 0; i < 30; i++) {
      await expectCode(wrong(`guess${i}@example.com`, "198.51.100.50"), "AUTH_INVALID_CREDENTIALS");
    }
    await expectCode(right("198.51.100.50"), "AUTH_RATE_LIMITED");
    await expect(right("198.51.100.51")).resolves.toBeDefined();
  });

  it("puts requests with an unknown client IP in one shared bucket", async () => {
    await activeCustomer({ email: "sara@example.com" });
    const unknownIp = (email: string, password: string) =>
      service.login({ email, password }, meta(null));
    for (let i = 0; i < 30; i++) {
      await expectCode(
        unknownIp(`guess${i}@example.com`, "wrong password here"),
        "AUTH_INVALID_CREDENTIALS",
      );
    }
    await expectCode(unknownIp("sara@example.com", PASSWORD), "AUTH_RATE_LIMITED");
    const bucket = await db.rateLimitBucket.findUniqueOrThrow({
      where: { key: "login:ip:unknown" },
    });
    expect(bucket.blockedUntil).toEqual(new Date(START + 15 * MS_PER_MINUTE));
  });
});

describe("refresh", () => {
  async function signIn() {
    await activeCustomer({ email: "sara@example.com" });
    return service.login({ email: "sara@example.com", password: PASSWORD }, meta());
  }

  it("rotates the pair; the old access token stops working", async () => {
    const first = await signIn();
    advance(MS_PER_MINUTE);
    const second = await service.refresh(first.tokens.refreshToken, meta());

    expect(second.tokens.accessToken).not.toBe(first.tokens.accessToken);
    expect(second.tokens.refreshToken).not.toBe(first.tokens.refreshToken);
    // The session keeps its absolute expiry (Q162).
    expect(second.sessionExpiresAt).toEqual(first.sessionExpiresAt);
    await expect(service.authenticate(second.tokens.accessToken)).resolves.toBeDefined();
    await expectCode(service.authenticate(first.tokens.accessToken), "UNAUTHENTICATED");
  });

  it("rejects a superseded refresh token within the grace window without revoking", async () => {
    const first = await signIn();
    const second = await service.refresh(first.tokens.refreshToken, meta());
    advance(5 * MS_PER_SECOND);
    await expectCode(service.refresh(first.tokens.refreshToken, meta()), "UNAUTHENTICATED");
    await expect(service.authenticate(second.tokens.accessToken)).resolves.toBeDefined();
  });

  it("revokes the whole session when a superseded refresh token is reused", async () => {
    const first = await signIn();
    const second = await service.refresh(first.tokens.refreshToken, meta());
    advance(11 * MS_PER_SECOND);
    await expectCode(service.refresh(first.tokens.refreshToken, meta()), "UNAUTHENTICATED");

    await expectCode(service.authenticate(second.tokens.accessToken), "UNAUTHENTICATED");
    await expectCode(service.refresh(second.tokens.refreshToken, meta()), "UNAUTHENTICATED");
    const session = await db.authSession.findFirstOrThrow();
    expect(session.revokeReason).toBe("REUSE_DETECTED");
  });

  it("lets only one of two concurrent refreshes with the same token win", async () => {
    const first = await signIn();
    const results = await Promise.allSettled([
      service.refresh(first.tokens.refreshToken, meta()),
      service.refresh(first.tokens.refreshToken, meta()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const session = await db.authSession.findFirstOrThrow();
    expect(session.revokedAt).toBeNull();
  });

  it("ends 30 days after login regardless of activity", async () => {
    let signedIn = await signIn();
    for (let day = 0; day < 29; day++) {
      advance(MS_PER_DAY);
      signedIn = await service.refresh(signedIn.tokens.refreshToken, meta());
    }
    expect(signedIn.tokens.refreshTokenExpiresAt).toEqual(new Date(START + 30 * MS_PER_DAY));
    advance(MS_PER_DAY);
    await expectCode(service.refresh(signedIn.tokens.refreshToken, meta()), "UNAUTHENTICATED");
  });

  it("caps the access token at the session expiry", async () => {
    let signedIn = await signIn();
    advance(30 * MS_PER_DAY - 5 * MS_PER_MINUTE);
    signedIn = await service.refresh(signedIn.tokens.refreshToken, meta());
    expect(signedIn.tokens.accessTokenExpiresAt).toEqual(new Date(START + 30 * MS_PER_DAY));
  });

  it("refuses malformed and unknown tokens", async () => {
    await expectCode(service.refresh("not-a-token", meta()), "UNAUTHENTICATED");
    await expectCode(service.refresh(`bfr_${"a".repeat(43)}`, meta()), "UNAUTHENTICATED");
  });

  it("refuses a suspended account", async () => {
    const signedIn = await signIn();
    await db.account.update({
      where: { id: signedIn.view.account.id },
      data: { status: "SUSPENDED" },
    });
    await expectCode(service.refresh(signedIn.tokens.refreshToken, meta()), "FORBIDDEN");
  });
});

describe("authenticate (session validation)", () => {
  it("rejects an expired access token; refresh still works", async () => {
    await activeCustomer({ email: "sara@example.com" });
    const signedIn = await service.login({ email: "sara@example.com", password: PASSWORD }, meta());
    advance(15 * MS_PER_MINUTE);
    await expectCode(service.authenticate(signedIn.tokens.accessToken), "UNAUTHENTICATED");
    await expect(service.refresh(signedIn.tokens.refreshToken, meta())).resolves.toBeDefined();
  });

  it("returns FORBIDDEN for an employee-domain session and for suspended accounts", async () => {
    const customer = await activeCustomer({ email: "sara@example.com" });
    const employeeSession = await createSession(
      db,
      { accountId: customer.accountId, domain: "EMPLOYEE", ttlMs: MS_PER_DAY },
      meta(),
      clock.now(),
    );
    await expectCode(service.authenticate(employeeSession.tokens.accessToken), "FORBIDDEN");

    const signedIn = await service.login({ email: "sara@example.com", password: PASSWORD }, meta());
    await db.account.update({ where: { id: customer.accountId }, data: { status: "DEACTIVATED" } });
    await expectCode(service.authenticate(signedIn.tokens.accessToken), "FORBIDDEN");
  });

  it("updates last_used_at at most once a minute", async () => {
    await activeCustomer({ email: "sara@example.com" });
    const signedIn = await service.login({ email: "sara@example.com", password: PASSWORD }, meta());
    advance(30 * MS_PER_SECOND);
    await service.authenticate(signedIn.tokens.accessToken);
    expect((await db.authSession.findFirstOrThrow()).lastUsedAt).toEqual(new Date(START));
    advance(40 * MS_PER_SECOND);
    await service.authenticate(signedIn.tokens.accessToken);
    expect((await db.authSession.findFirstOrThrow()).lastUsedAt).toEqual(clock.now());
  });
});

describe("logout, logout-all and password change", () => {
  async function twoSessions() {
    await activeCustomer({ email: "sara@example.com" });
    const phone = await service.login({ email: "sara@example.com", password: PASSWORD }, meta());
    const laptop = await service.login({ email: "sara@example.com", password: PASSWORD }, meta());
    const principal = await service.authenticate(phone.tokens.accessToken);
    return { phone, laptop, principal };
  }

  it("logout revokes only the current session", async () => {
    const { phone, laptop, principal } = await twoSessions();
    await service.logout(principal, meta());
    await expectCode(service.authenticate(phone.tokens.accessToken), "UNAUTHENTICATED");
    await expectCode(service.refresh(phone.tokens.refreshToken, meta()), "UNAUTHENTICATED");
    await expect(service.authenticate(laptop.tokens.accessToken)).resolves.toBeDefined();
  });

  it("logout-all revokes every session (Q164)", async () => {
    const { phone, laptop, principal } = await twoSessions();
    await service.logoutAll(principal, meta());
    await expectCode(service.authenticate(phone.tokens.accessToken), "UNAUTHENTICATED");
    await expectCode(service.authenticate(laptop.tokens.accessToken), "UNAUTHENTICATED");
    const reasons = (await db.authSession.findMany()).map((s) => s.revokeReason);
    expect(reasons).toEqual(["LOGOUT_ALL", "LOGOUT_ALL"]);
  });

  it("password change keeps the current session and revokes the others (R23)", async () => {
    const { phone, laptop, principal } = await twoSessions();
    await service.changePassword(
      principal,
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      meta(),
    );
    await expect(service.authenticate(phone.tokens.accessToken)).resolves.toBeDefined();
    await expectCode(service.authenticate(laptop.tokens.accessToken), "UNAUTHENTICATED");
    await expectCode(
      service.login({ email: "sara@example.com", password: PASSWORD }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
    await expect(
      service.login({ email: "sara@example.com", password: NEW_PASSWORD }, meta()),
    ).resolves.toBeDefined();
  });

  it("counts wrong current passwords toward the account lockout", async () => {
    const { principal } = await twoSessions();
    for (let i = 0; i < 5; i++) {
      await expectCode(
        service.changePassword(
          principal,
          { currentPassword: "wrong password here", newPassword: NEW_PASSWORD },
          meta(),
        ),
        "AUTH_INVALID_CREDENTIALS",
      );
    }
    await expectCode(
      service.changePassword(
        principal,
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        meta(),
      ),
      "AUTH_RATE_LIMITED",
    );
    await expectCode(
      service.login({ email: "sara@example.com", password: PASSWORD }, meta()),
      "AUTH_RATE_LIMITED",
    );
  });
});
