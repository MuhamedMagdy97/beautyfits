import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { EmployeeLevel } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { EmailMessage, EmailSender } from "@/server/email/email";
import { AppError, type ErrorCode } from "@/server/errors/app-error";
import { createLogger } from "@/server/logging/logger";
import { createAuthService, type RequestMeta } from "@/server/modules/auth/auth-service";
import {
  createEmployeeAuthService,
  type EmployeeLoginResult,
  type EmployeeSignedIn,
} from "@/server/modules/auth/employee-auth-service";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import {
  DEFAULT_STAFF_SESSION_SETTINGS,
  type StaffSessionSettings,
} from "@/server/modules/auth/policy";
import { createVerificationService } from "@/server/modules/auth/verification-service";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "@/server/time/time";
import { resetDatabase } from "@/test/integration/database";

const db = getDb();
const START = new Date("2026-10-01T10:00:00.000Z").getTime();
let nowMs = START;
const clock = { now: () => new Date(nowMs) };
const hasher = createScryptHasher({ N: 1024, r: 8, p: 1, keyLength: 32, saltLength: 16 });

const outbox: EmailMessage[] = [];
const email: EmailSender = {
  async send(message) {
    outbox.push(message);
  },
};

let settings: StaffSessionSettings = DEFAULT_STAFF_SESSION_SETTINGS;
const staff = createEmployeeAuthService({
  db,
  clock,
  hasher,
  email,
  sessionSettings: async () => settings,
});
const customers = createAuthService({ db, clock, hasher, email });
const verification = createVerificationService({ db, clock, hasher, email });

const logLines: string[] = [];
const logger = createLogger({ level: "debug", write: (_level, line) => logLines.push(line) });

const PASSWORD = "teal lantern over the nile";
const NEW_PASSWORD = "violet kettle on the balcony";
const EMAIL = "mona@beautyfits.example";

function meta(ip: string | null = "198.51.100.4"): RequestMeta {
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

async function createEmployee(
  options: { email?: string; level?: EmployeeLevel; active?: boolean } = {},
) {
  const account = await db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email: options.email ?? EMAIL,
      emailVerifiedAt: new Date(nowMs),
      passwordHash: await hasher.hash(PASSWORD),
      status: "ACTIVE",
      employee: {
        create: {
          displayName: "Mona Hassan",
          employeeLevel: options.level ?? "EMPLOYEE",
          status: options.active === false ? "DEACTIVATED" : "ACTIVE",
        },
      },
    },
    include: { employee: true },
  });
  return account;
}

function ticketOf(result: EmployeeLoginResult) {
  if (!result.otpRequired) {
    throw new Error("expected an email code step");
  }
  return result;
}

function signedInOf(result: EmployeeLoginResult): EmployeeSignedIn {
  if (result.otpRequired) {
    throw new Error("expected a direct sign-in");
  }
  return result.signedIn;
}

/** Full login on a new device: password, then the emailed code. */
async function loginWithCode(emailAddress = EMAIL): Promise<EmployeeSignedIn> {
  const step1 = ticketOf(await staff.login({ email: emailAddress, password: PASSWORD }, meta()));
  return staff.verifyLoginCode(
    { loginTicket: step1.loginTicket, code: lastCode(emailAddress) },
    meta(),
  );
}

beforeEach(async () => {
  await resetDatabase();
  nowMs = START;
  outbox.length = 0;
  logLines.length = 0;
  settings = DEFAULT_STAFF_SESSION_SETTINGS;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("employee login (R28)", () => {
  it("asks a new device for an emailed code, then signs in and trusts the device for 30 days", async () => {
    const account = await createEmployee();
    const step1 = ticketOf(await staff.login({ email: EMAIL, password: PASSWORD }, meta()));
    expect(step1).toMatchObject({ codeSent: true, cooldownSeconds: 60 });
    expect(step1.loginTicketExpiresAt).toEqual(new Date(START + 15 * MS_PER_MINUTE));
    expect(await db.authSession.count()).toBe(0);

    // Staff emails are bilingual: Arabic, then English.
    const message = outbox.at(-1)!;
    expect(message.subject).toMatch(/[؀-ۿ].*\|.*staff sign-in code/);
    expect(message.text.indexOf("BeautyFits staff sign-in code")).toBeGreaterThan(
      message.text.indexOf("هو"),
    );

    const signedIn = await staff.verifyLoginCode(
      { loginTicket: step1.loginTicket, code: lastCode() },
      meta(),
    );
    expect(signedIn.view).toEqual({
      account: { id: account.id, email: EMAIL, status: "ACTIVE" },
      employee: {
        id: account.employee!.id,
        displayName: "Mona Hassan",
        level: "EMPLOYEE",
        department: null,
      },
    });
    // R29 defaults: 12 hours maximum, 60 minutes idle.
    expect(signedIn.session).toEqual({
      expiresAt: new Date(START + 12 * MS_PER_HOUR),
      idleTimeoutSeconds: 3600,
    });
    expect(signedIn.trustedDevice?.token).toMatch(/^bfd_/);
    expect(signedIn.trustedDevice?.expiresAt).toEqual(new Date(START + 30 * MS_PER_DAY));

    const device = await db.employeeTrustedDevice.findFirstOrThrow();
    expect(device).toMatchObject({ accountId: account.id, revokedAt: null });
    expect(device.deviceTokenHash).not.toContain(signedIn.trustedDevice!.token);
    const session = await db.authSession.findFirstOrThrow();
    expect(session.domain).toBe("EMPLOYEE");
  });

  it("applies to Owner and Admin too (no separate factor)", async () => {
    for (const [level, address] of [
      ["OWNER", "owner@beautyfits.example"],
      ["ADMIN", "admin@beautyfits.example"],
    ] as const) {
      await createEmployee({ level, email: address });
      const result = await staff.login({ email: address, password: PASSWORD }, meta());
      expect(result.otpRequired).toBe(true);
    }
  });

  it("signs in with the password only on a trusted device", async () => {
    await createEmployee();
    const first = await loginWithCode();
    const sent = outbox.length;

    advance(2 * MS_PER_HOUR);
    const again = signedInOf(
      await staff.login(
        { email: EMAIL, password: PASSWORD, deviceToken: first.trustedDevice!.token },
        meta(),
      ),
    );
    expect(again.trustedDevice).toBeUndefined();
    expect(outbox.length).toBe(sent);
    expect(await db.authSession.count()).toBe(2);
  });

  it("asks for the code again after 30 days", async () => {
    await createEmployee();
    const { trustedDevice } = await loginWithCode();
    advance(30 * MS_PER_DAY - MS_PER_SECOND);
    const before = await staff.login(
      { email: EMAIL, password: PASSWORD, deviceToken: trustedDevice!.token },
      meta(),
    );
    expect(before.otpRequired).toBe(false);
    advance(MS_PER_SECOND);
    const after = await staff.login(
      { email: EMAIL, password: PASSWORD, deviceToken: trustedDevice!.token },
      meta(),
    );
    expect(after.otpRequired).toBe(true);
  });

  it("does not accept another employee's device, a revoked device or a malformed token", async () => {
    await createEmployee();
    await createEmployee({ email: "omar@beautyfits.example" });
    const omar = await loginWithCode("omar@beautyfits.example");
    advance(MS_PER_MINUTE);

    const foreign = await staff.login(
      { email: EMAIL, password: PASSWORD, deviceToken: omar.trustedDevice!.token },
      meta(),
    );
    expect(foreign.otpRequired).toBe(true);

    await db.employeeTrustedDevice.updateMany({ data: { revokedAt: new Date(nowMs) } });
    advance(MS_PER_MINUTE);
    const revoked = await staff.login(
      {
        email: "omar@beautyfits.example",
        password: PASSWORD,
        deviceToken: omar.trustedDevice!.token,
      },
      meta(),
    );
    expect(revoked.otpRequired).toBe(true);

    advance(MS_PER_MINUTE);
    const malformed = await staff.login(
      { email: EMAIL, password: PASSWORD, deviceToken: "not-a-token" },
      meta(),
    );
    expect(malformed.otpRequired).toBe(true);
  });

  it("answers unknown email and wrong password the same and locks after 5 failures (R24 values)", async () => {
    await createEmployee();
    await expectCode(
      staff.login({ email: "nobody@beautyfits.example", password: PASSWORD }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
    for (let i = 0; i < 5; i += 1) {
      await expectCode(
        staff.login({ email: EMAIL, password: "wrong password here" }, meta()),
        "AUTH_INVALID_CREDENTIALS",
      );
    }
    const locked = await expectCode(
      staff.login({ email: EMAIL, password: PASSWORD }, meta()),
      "AUTH_RATE_LIMITED",
    );
    expect(locked.details.retryAfterSeconds).toBe(15 * 60);
    advance(15 * MS_PER_MINUTE);
    expect((await staff.login({ email: EMAIL, password: PASSWORD }, meta())).otpRequired).toBe(
      true,
    );
  });

  it("refuses a deactivated employee after the password check", async () => {
    await createEmployee({ active: false });
    await expectCode(staff.login({ email: EMAIL, password: PASSWORD }, meta()), "FORBIDDEN");
    expect(outbox).toHaveLength(0);
  });

  it("keeps employee and customer logins apart for a shared email (R15)", async () => {
    await createEmployee();
    // A customer password never signs in as the employee.
    await expectCode(
      customers.login({ email: EMAIL, password: PASSWORD }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
  });
});

describe("login code", () => {
  it("counts wrong codes and dies after 5 attempts (Q158)", async () => {
    await createEmployee();
    const step1 = ticketOf(await staff.login({ email: EMAIL, password: PASSWORD }, meta()));
    const code = lastCode();
    for (let remaining = 4; remaining >= 0; remaining -= 1) {
      const error = await expectCode(
        staff.verifyLoginCode({ loginTicket: step1.loginTicket, code: wrong(code) }, meta()),
        "AUTH_OTP_INVALID",
      );
      expect(error.details.attemptsRemaining).toBe(remaining);
    }
    const dead = await expectCode(
      staff.verifyLoginCode({ loginTicket: step1.loginTicket, code }, meta()),
      "AUTH_OTP_INVALID",
    );
    expect(dead.details.attemptsRemaining).toBe(0);
  });

  it("expires after 5 minutes; a resend after 60 s issues a new code and ticket (Q159, Q160)", async () => {
    await createEmployee();
    const step1 = ticketOf(await staff.login({ email: EMAIL, password: PASSWORD }, meta()));
    const firstCode = lastCode();

    await expectCode(
      staff.resendLoginCode({ loginTicket: step1.loginTicket }, meta()),
      "AUTH_RATE_LIMITED",
    );

    advance(5 * MS_PER_MINUTE);
    await expectCode(
      staff.verifyLoginCode({ loginTicket: step1.loginTicket, code: firstCode }, meta()),
      "AUTH_OTP_EXPIRED",
    );

    const resent = await staff.resendLoginCode({ loginTicket: step1.loginTicket }, meta());
    expect(resent.loginTicket).not.toBe(step1.loginTicket);
    // The ticket keeps the window of the original password check.
    expect(resent.loginTicketExpiresAt).toEqual(step1.loginTicketExpiresAt);
    // The old ticket stops working.
    await expectCode(
      staff.verifyLoginCode({ loginTicket: step1.loginTicket, code: lastCode() }, meta()),
      "AUTH_OTP_INVALID",
    );
    const signedIn = await staff.verifyLoginCode(
      { loginTicket: resent.loginTicket, code: lastCode() },
      meta(),
    );
    expect(signedIn.tokens.accessToken).toMatch(/^bfa_/);
  });

  it("requires the password again 15 minutes after it was checked", async () => {
    await createEmployee();
    const step1 = ticketOf(await staff.login({ email: EMAIL, password: PASSWORD }, meta()));
    advance(4 * MS_PER_MINUTE);
    const resent = await staff.resendLoginCode({ loginTicket: step1.loginTicket }, meta());
    advance(11 * MS_PER_MINUTE);
    await expectCode(
      staff.verifyLoginCode({ loginTicket: resent.loginTicket, code: lastCode() }, meta()),
      "AUTH_OTP_EXPIRED",
    );
    await expectCode(
      staff.resendLoginCode({ loginTicket: resent.loginTicket }, meta()),
      "AUTH_OTP_EXPIRED",
    );
  });

  it("is single use and needs the ticket: the code alone never signs in", async () => {
    await createEmployee();
    const step1 = ticketOf(await staff.login({ email: EMAIL, password: PASSWORD }, meta()));
    const code = lastCode();
    await expectCode(
      staff.verifyLoginCode({ loginTicket: `bfl_${"A".repeat(43)}`, code }, meta()),
      "AUTH_OTP_INVALID",
    );
    await staff.verifyLoginCode({ loginTicket: step1.loginTicket, code }, meta());
    await expectCode(
      staff.verifyLoginCode({ loginTicket: step1.loginTicket, code }, meta()),
      "AUTH_OTP_INVALID",
    );
    expect(await db.authSession.count()).toBe(1);
  });

  it("logs no codes, tickets or tokens", async () => {
    await createEmployee();
    const step1 = ticketOf(await staff.login({ email: EMAIL, password: PASSWORD }, meta()));
    const code = lastCode();
    const signedIn = await staff.verifyLoginCode({ loginTicket: step1.loginTicket, code }, meta());
    const logs = logLines.join("\n");
    for (const secret of [
      code,
      step1.loginTicket,
      signedIn.trustedDevice!.token,
      signedIn.tokens.accessToken,
      signedIn.tokens.refreshToken,
      EMAIL,
      PASSWORD,
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});

describe("staff sessions (R29)", () => {
  it("end after 60 minutes without activity; activity keeps them alive", async () => {
    await createEmployee();
    let signedIn = await loginWithCode();
    // Two hours of work: a request every 14 minutes, refreshing the access token.
    for (let minutes = 0; minutes < 120; minutes += 14) {
      advance(14 * MS_PER_MINUTE);
      signedIn = await staff.refresh(signedIn.tokens.refreshToken, meta());
      await staff.authenticate(signedIn.tokens.accessToken);
    }
    advance(59 * MS_PER_MINUTE);
    signedIn = await staff.refresh(signedIn.tokens.refreshToken, meta());
    advance(MS_PER_MINUTE);
    await expectCode(staff.authenticate(signedIn.tokens.accessToken), "UNAUTHENTICATED");
    await expectCode(staff.refresh(signedIn.tokens.refreshToken, meta()), "UNAUTHENTICATED");
  });

  it("does not count a refresh as activity", async () => {
    await createEmployee();
    let signedIn = await loginWithCode();
    for (let minutes = 15; minutes < 60; minutes += 15) {
      advance(15 * MS_PER_MINUTE);
      signedIn = await staff.refresh(signedIn.tokens.refreshToken, meta());
    }
    advance(15 * MS_PER_MINUTE);
    await expectCode(staff.refresh(signedIn.tokens.refreshToken, meta()), "UNAUTHENTICATED");
  });

  it("end 12 hours after login even with activity", async () => {
    await createEmployee();
    let signedIn = await loginWithCode();
    for (let minutes = 0; minutes < 12 * 60 - 15; minutes += 15) {
      advance(15 * MS_PER_MINUTE);
      signedIn = await staff.refresh(signedIn.tokens.refreshToken, meta());
      await staff.authenticate(signedIn.tokens.accessToken);
    }
    expect(signedIn.tokens.accessTokenExpiresAt).toEqual(new Date(START + 12 * MS_PER_HOUR));
    advance(15 * MS_PER_MINUTE);
    await expectCode(staff.authenticate(signedIn.tokens.accessToken), "UNAUTHENTICATED");
    await expectCode(staff.refresh(signedIn.tokens.refreshToken, meta()), "UNAUTHENTICATED");
  });

  it("use the configured lengths (Q163)", async () => {
    settings = { maxLifetimeMs: 8 * MS_PER_HOUR, idleTimeoutMs: 30 * MS_PER_MINUTE };
    await createEmployee();
    const signedIn = await loginWithCode();
    expect(signedIn.session).toEqual({
      expiresAt: new Date(START + 8 * MS_PER_HOUR),
      idleTimeoutSeconds: 1800,
    });
    advance(30 * MS_PER_MINUTE);
    await expectCode(staff.refresh(signedIn.tokens.refreshToken, meta()), "UNAUTHENTICATED");
  });

  it("never cross domains: customer and employee tokens are FORBIDDEN on the other side", async () => {
    await createEmployee();
    const employee = await loginWithCode();
    await expectCode(customers.authenticate(employee.tokens.accessToken), "FORBIDDEN");
    await expectCode(customers.refresh(employee.tokens.refreshToken, meta()), "FORBIDDEN");

    await customers.register(
      {
        email: "sara@example.com",
        password: PASSWORD,
        phone: "+201012345678",
        fullName: "Sara Ali",
        preferredLocale: "en",
      },
      meta(),
    );
    await verification.verifyEmail(
      { email: "sara@example.com", code: lastCode("sara@example.com") },
      meta(),
    );
    const customer = await customers.login(
      { email: "sara@example.com", password: PASSWORD },
      meta(),
    );
    await expectCode(staff.authenticate(customer.tokens.accessToken), "FORBIDDEN");
    await expectCode(staff.refresh(customer.tokens.refreshToken, meta()), "FORBIDDEN");
  });

  it("are refused once the employee is deactivated", async () => {
    const account = await createEmployee();
    const signedIn = await loginWithCode();
    await db.employee.update({
      where: { id: account.employee!.id },
      data: { status: "DEACTIVATED", deactivatedAt: new Date(nowMs) },
    });
    await expectCode(staff.authenticate(signedIn.tokens.accessToken), "FORBIDDEN");
    await expectCode(staff.refresh(signedIn.tokens.refreshToken, meta()), "FORBIDDEN");
  });

  it("rotate refresh tokens and revoke the session on reuse", async () => {
    await createEmployee();
    const first = await loginWithCode();
    const second = await staff.refresh(first.tokens.refreshToken, meta());
    await expectCode(staff.authenticate(first.tokens.accessToken), "UNAUTHENTICATED");
    advance(11 * MS_PER_SECOND);
    await expectCode(staff.refresh(first.tokens.refreshToken, meta()), "UNAUTHENTICATED");
    await expectCode(staff.authenticate(second.tokens.accessToken), "UNAUTHENTICATED");
    const session = await db.authSession.findFirstOrThrow();
    expect(session.revokeReason).toBe("REUSE_DETECTED");
  });

  it("log out one session or all of them; the device stays trusted", async () => {
    await createEmployee();
    const a = await loginWithCode();
    advance(MS_PER_MINUTE);
    const b = signedInOf(
      await staff.login(
        { email: EMAIL, password: PASSWORD, deviceToken: a.trustedDevice!.token },
        meta(),
      ),
    );
    const principalA = await staff.authenticate(a.tokens.accessToken);
    await staff.logout(principalA, meta());
    await expectCode(staff.authenticate(a.tokens.accessToken), "UNAUTHENTICATED");
    const principalB = await staff.authenticate(b.tokens.accessToken);

    await staff.logoutAll(principalB, meta());
    expect(await db.authSession.count({ where: { revokedAt: null } })).toBe(0);
    expect(await db.employeeTrustedDevice.count({ where: { revokedAt: null } })).toBe(1);
  });
});

describe("employee password recovery (R29)", () => {
  it("emails a code, sets the new password and revokes every session", async () => {
    await createEmployee();
    const signedIn = await loginWithCode();
    advance(MS_PER_MINUTE);

    expect(await staff.forgotPassword({ email: EMAIL }, meta())).toEqual({ cooldownSeconds: 60 });
    await staff.resetPassword(
      { email: EMAIL, code: lastCode(), newPassword: NEW_PASSWORD },
      meta(),
    );

    await expectCode(staff.authenticate(signedIn.tokens.accessToken), "UNAUTHENTICATED");
    const session = await db.authSession.findFirstOrThrow();
    expect(session.revokeReason).toBe("PASSWORD_RESET");
    await expectCode(
      staff.login({ email: EMAIL, password: PASSWORD }, meta()),
      "AUTH_INVALID_CREDENTIALS",
    );
    const result = await staff.login(
      { email: EMAIL, password: NEW_PASSWORD, deviceToken: signedIn.trustedDevice!.token },
      meta(),
    );
    expect(result.otpRequired).toBe(false);
  });

  it("answers the same for an unknown email and sends nothing", async () => {
    expect(await staff.forgotPassword({ email: "nobody@beautyfits.example" }, meta())).toEqual({
      cooldownSeconds: 60,
    });
    expect(outbox).toHaveLength(0);
    await expectCode(
      staff.resetPassword(
        { email: "nobody@beautyfits.example", code: "123456", newPassword: NEW_PASSWORD },
        meta(),
      ),
      "AUTH_OTP_INVALID",
    );
  });

  it("rejects wrong and expired codes", async () => {
    await createEmployee();
    await staff.forgotPassword({ email: EMAIL }, meta());
    const code = lastCode();
    const error = await expectCode(
      staff.resetPassword({ email: EMAIL, code: wrong(code), newPassword: NEW_PASSWORD }, meta()),
      "AUTH_OTP_INVALID",
    );
    expect(error.details.attemptsRemaining).toBe(4);
    advance(5 * MS_PER_MINUTE);
    await expectCode(
      staff.resetPassword({ email: EMAIL, code, newPassword: NEW_PASSWORD }, meta()),
      "AUTH_OTP_EXPIRED",
    );
  });

  it("keeps a customer's and an employee's reset codes apart for a shared email (R15)", async () => {
    const employee = await createEmployee({ email: "sara@example.com" });
    await customers.register(
      {
        email: "sara@example.com",
        password: PASSWORD,
        phone: "+201012345678",
        fullName: "Sara Ali",
        preferredLocale: "en",
      },
      meta(),
    );
    await verification.verifyEmail(
      { email: "sara@example.com", code: lastCode("sara@example.com") },
      meta(),
    );

    // The employee asks for a code; the customer endpoint cannot use it.
    await staff.forgotPassword({ email: "sara@example.com" }, meta());
    const employeeCode = lastCode("sara@example.com");
    await expectCode(
      verification.verifyRecoveryCode({ email: "sara@example.com", code: employeeCode }, meta()),
      "AUTH_OTP_INVALID",
    );

    // The customer's own code does not supersede the employee's, and neither
    // limit blocks the other.
    await verification.sendCode({ email: "sara@example.com", purpose: "PASSWORD_RESET" }, meta());
    const customerCode = lastCode("sara@example.com");
    await expectCode(
      staff.resetPassword(
        { email: "sara@example.com", code: customerCode, newPassword: NEW_PASSWORD },
        meta(),
      ),
      "AUTH_OTP_INVALID",
    );
    await staff.resetPassword(
      { email: "sara@example.com", code: employeeCode, newPassword: NEW_PASSWORD },
      meta(),
    );
    const updated = await db.account.findUniqueOrThrow({ where: { id: employee.id } });
    expect(await hasher.verify(NEW_PASSWORD, updated.passwordHash)).toBe(true);
    const grant = await verification.verifyRecoveryCode(
      { email: "sara@example.com", code: customerCode },
      meta(),
    );
    expect(grant.resetToken).toMatch(/^bfp_/);
  });
});
