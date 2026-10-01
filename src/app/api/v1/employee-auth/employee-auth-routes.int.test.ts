import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { POST as customerLogin } from "@/app/api/v1/auth/login/route";
import { POST as forgotPassword } from "@/app/api/v1/employee-auth/forgot-password/route";
import { POST as login } from "@/app/api/v1/employee-auth/login/route";
import { POST as logoutAll } from "@/app/api/v1/employee-auth/logout-all/route";
import { POST as logout } from "@/app/api/v1/employee-auth/logout/route";
import { POST as refresh } from "@/app/api/v1/employee-auth/refresh/route";
import { POST as resendOtp } from "@/app/api/v1/employee-auth/resend-otp/route";
import { POST as resetPassword } from "@/app/api/v1/employee-auth/reset-password/route";
import { GET as session } from "@/app/api/v1/employee-auth/session/route";
import { POST as verifyOtp } from "@/app/api/v1/employee-auth/verify-otp/route";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createScryptHasher } from "@/server/modules/auth/password-hash";
import {
  ACCESS_COOKIE,
  EMPLOYEE_COOKIES,
  EMPLOYEE_DEVICE_COOKIE,
} from "@/server/modules/auth/transport";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of /api/v1/employee-auth (API contract "TASK-011
 * Amendments"): the two-step login, trusted-device cookie and body token,
 * session limits, separation from customer sessions, recovery. Uses the
 * real service and the test database; codes are read from the local mailbox.
 */

const db = getDb();
const BASE = "http://localhost/api/v1/employee-auth";
const SAME_ORIGIN = "http://localhost";
const PASSWORD = "teal lantern over the nile";
const EMAIL = "mona@beautyfits.example";

type Handler = (request: Request, context: unknown) => Promise<Response>;

function call(
  handler: Handler,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return handler(
    new Request(`${BASE}${path}`, {
      method: options.method ?? "POST",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    {},
  );
}

function cookieHeader(...responses: Response[]): string {
  const jar = new Map<string, string>();
  for (const response of responses) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function mailedCode(to: string): Promise<string> {
  const dir = getEnv().MAIL_DIR;
  const files = (await readdir(dir)).filter((name) => name.endsWith(".eml")).sort();
  for (const name of files.reverse()) {
    const eml = await readFile(join(dir, name), "utf8");
    if (!eml.includes(`\r\nTo: ${to}\r\n`)) {
      continue;
    }
    const body = Buffer.from(eml.split("\r\n\r\n")[1].replace(/\s/g, ""), "base64");
    const match = /\b(\d{6})\b/.exec(body.toString("utf8"));
    if (match) {
      return match[1];
    }
  }
  throw new Error(`no code mailed to ${to}`);
}

async function createEmployee(email = EMAIL) {
  return db.account.create({
    data: {
      accountType: "EMPLOYEE",
      email,
      emailVerifiedAt: new Date(),
      passwordHash: await createScryptHasher().hash(PASSWORD),
      status: "ACTIVE",
      employee: { create: { displayName: "Mona Hassan", employeeLevel: "MANAGER" } },
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await rm(getEnv().MAIL_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("website (cookie transport)", () => {
  it("signs in with an emailed code, then skips it on the trusted device", async () => {
    await createEmployee();
    const cookieHeaders = { "x-auth-transport": "cookie", origin: SAME_ORIGIN };

    const step1 = await call(login, "/login", {
      headers: cookieHeaders,
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(step1.status).toBe(202);
    const ticket = (await step1.json()).data;
    expect(ticket).toMatchObject({ otpRequired: true, codeSent: true, cooldownSeconds: 60 });
    expect(step1.headers.getSetCookie()).toEqual([]);

    const step2 = await call(verifyOtp, "/verify-otp", {
      headers: cookieHeaders,
      body: { loginTicket: ticket.loginTicket, code: await mailedCode(EMAIL) },
    });
    expect(step2.status).toBe(200);
    const body = (await step2.json()).data;
    expect(body.tokens).toBeUndefined();
    expect(body.deviceToken).toBeUndefined();
    expect(body.employee).toMatchObject({ displayName: "Mona Hassan", level: "MANAGER" });
    expect(body.session.idleTimeoutSeconds).toBe(3600);
    expect(body.deviceTrustedUntil).toEqual(expect.any(String));

    const cookies = step2.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toMatch(/^__Host-bfe_at=bfa_.+; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/);
    expect(cookies[1]).toMatch(/^__Secure-bfe_rt=bfr_.+; Path=\/api\/v1\/employee-auth;/);
    expect(cookies[2]).toMatch(
      new RegExp(
        `^${EMPLOYEE_DEVICE_COOKIE}=bfd_.+; Path=/api/v1/employee-auth; Max-Age=259(1999|2000);`,
      ),
    );
    const cookie = cookieHeader(step2);

    const current = await call(session, "/session", { method: "GET", headers: { cookie } });
    expect(current.status).toBe(200);
    expect((await current.json()).data.account.email).toBe(EMAIL);

    // Logout clears the session cookies but keeps the device cookie.
    const loggedOut = await call(logout, "/logout", { headers: { cookie, origin: SAME_ORIGIN } });
    expect(loggedOut.status).toBe(204);
    const cleared = loggedOut.headers.getSetCookie();
    expect(cleared.map((c) => c.split("=")[0])).toEqual([
      EMPLOYEE_COOKIES.access,
      EMPLOYEE_COOKIES.refresh,
    ]);

    const again = await call(login, "/login", {
      headers: { ...cookieHeaders, cookie },
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(again.status).toBe(200);
    expect(again.headers.getSetCookie()).toHaveLength(2);
  });

  it("refreshes with the employee refresh cookie behind the CSRF check", async () => {
    await createEmployee();
    const cookieHeaders = { "x-auth-transport": "cookie", origin: SAME_ORIGIN };
    const step1 = await call(login, "/login", {
      headers: cookieHeaders,
      body: { email: EMAIL, password: PASSWORD },
    });
    const { loginTicket } = (await step1.json()).data;
    const step2 = await call(verifyOtp, "/verify-otp", {
      headers: cookieHeaders,
      body: { loginTicket, code: await mailedCode(EMAIL) },
    });
    const cookie = cookieHeader(step2);

    expect((await call(refresh, "/refresh", { headers: { cookie } })).status).toBe(403);
    const refreshed = await call(refresh, "/refresh", { headers: { cookie, origin: SAME_ORIGIN } });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.getSetCookie()).toHaveLength(2);
  });

  it("requires an allowed Origin to sign in with cookies", async () => {
    await createEmployee();
    const response = await call(login, "/login", {
      headers: { "x-auth-transport": "cookie", origin: "https://evil.example" },
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(response.status).toBe(403);
  });
});

describe("mobile / Bearer transport", () => {
  it("returns tokens and the device token in the body", async () => {
    await createEmployee();
    const step1 = await call(login, "/login", { body: { email: EMAIL, password: PASSWORD } });
    const { loginTicket } = (await step1.json()).data;
    const step2 = await call(verifyOtp, "/verify-otp", {
      body: { loginTicket, code: await mailedCode(EMAIL) },
    });
    expect(step2.status).toBe(200);
    expect(step2.headers.getSetCookie()).toEqual([]);
    const data = (await step2.json()).data;
    expect(data.deviceToken).toMatch(/^bfd_/);
    expect(data.tokens.accessToken).toMatch(/^bfa_/);

    const current = await call(session, "/session", {
      method: "GET",
      headers: { authorization: `Bearer ${data.tokens.accessToken}` },
    });
    expect(current.status).toBe(200);

    const again = await call(login, "/login", {
      body: { email: EMAIL, password: PASSWORD, deviceToken: data.deviceToken },
    });
    expect(again.status).toBe(200);
    const next = (await again.json()).data;
    expect(next.deviceToken).toBeUndefined();

    const all = await call(logoutAll, "/logout-all", {
      headers: { authorization: `Bearer ${next.tokens.accessToken}` },
    });
    expect(all.status).toBe(204);
    const after = await call(session, "/session", {
      method: "GET",
      headers: { authorization: `Bearer ${data.tokens.accessToken}` },
    });
    expect(after.status).toBe(401);
  });

  it("answers a wrong code with attemptsRemaining and resends with a new ticket", async () => {
    await createEmployee();
    const step1 = await call(login, "/login", { body: { email: EMAIL, password: PASSWORD } });
    const { loginTicket } = (await step1.json()).data;
    const code = await mailedCode(EMAIL);
    const wrong = await call(verifyOtp, "/verify-otp", {
      body: { loginTicket, code: code === "000000" ? "111111" : "000000" },
    });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toMatchObject({
      code: "AUTH_OTP_INVALID",
      details: { attemptsRemaining: 4 },
    });

    const tooSoon = await call(resendOtp, "/resend-otp", { body: { loginTicket } });
    expect(tooSoon.status).toBe(429);
    expect((await tooSoon.json()).error.code).toBe("AUTH_RATE_LIMITED");
  });
});

describe("separate domains (R15)", () => {
  it("rejects a customer token and ignores the customer cookie", async () => {
    await createEmployee();
    const customerToken = `bfa_${"A".repeat(43)}`;
    const byCookie = await call(session, "/session", {
      method: "GET",
      headers: { cookie: `${ACCESS_COOKIE}=${customerToken}` },
    });
    expect(byCookie.status).toBe(401);

    // An employee login does not work on the customer endpoint.
    const customer = await call(customerLogin, "/login", {
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(customer.status).toBe(401);
  });
});

describe("password recovery", () => {
  it("answers 202 either way and resets with the emailed code", async () => {
    await createEmployee();
    const unknown = await call(forgotPassword, "/forgot-password", {
      body: { email: "nobody@beautyfits.example" },
    });
    expect(unknown.status).toBe(202);
    const known = await call(forgotPassword, "/forgot-password", { body: { email: EMAIL } });
    expect(known.status).toBe(202);
    expect(await known.json()).toMatchObject({ data: { cooldownSeconds: 60 } });

    const reset = await call(resetPassword, "/reset-password", {
      body: {
        email: EMAIL,
        code: await mailedCode(EMAIL),
        newPassword: "violet kettle on the balcony",
      },
    });
    expect(reset.status).toBe(204);

    const weak = await call(resetPassword, "/reset-password", {
      body: { email: EMAIL, code: "123456", newPassword: "short" },
    });
    expect(weak.status).toBe(400);
  });
});
