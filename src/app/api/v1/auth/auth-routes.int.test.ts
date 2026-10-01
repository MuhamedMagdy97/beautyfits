import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as changePassword } from "@/app/api/v1/auth/change-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logoutAll } from "@/app/api/v1/auth/logout-all/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { GET as session } from "@/app/api/v1/auth/session/route";
import { getDb } from "@/server/db/client";
import { CUSTOM_SERVER_MARKER, DIRECT_ADDRESS_HEADER } from "@/server/http/client-ip";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/server/modules/auth/transport";
import { resetDatabase } from "@/test/integration/database";

/**
 * HTTP-level tests of /api/v1/auth (API contract §10): envelopes, status
 * codes, cookie vs Bearer transport, CSRF and client-IP handling. Uses the
 * real service (production scrypt parameters) and the test database.
 */

const db = getDb();
const BASE = "http://localhost/api/v1/auth";
const SAME_ORIGIN = "http://localhost";
const PASSWORD = "teal lantern over the nile";

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

/** name=value pairs of Set-Cookie headers, for sending back as a Cookie header. */
function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function registerCustomer(
  email = "sara@example.com",
  verified: { email?: boolean; phone?: boolean } = { email: true, phone: true },
) {
  const response = await call(register, "/register", {
    body: { email, password: PASSWORD, phone: "01012345678", fullName: "Sara Ali" },
  });
  expect(response.status).toBe(201);
  const { data } = await response.json();
  const now = new Date();
  await db.account.update({
    where: { id: data.accountId },
    data: {
      emailVerifiedAt: verified.email ? now : null,
      status: verified.email && verified.phone ? "ACTIVE" : "PENDING_VERIFICATION",
    },
  });
  if (verified.phone) {
    await db.customer.update({
      where: { accountId: data.accountId },
      data: { phoneVerifiedAt: now },
    });
  }
  return data as { accountId: string };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("POST /auth/register", () => {
  it("returns 201 with the pending account", async () => {
    const response = await call(register, "/register", {
      headers: { "accept-language": "en-US,en;q=0.9" },
      body: {
        email: "Sara@Example.com",
        password: PASSWORD,
        phone: "+201012345678",
        fullName: "Sara Ali",
      },
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      status: "PENDING_VERIFICATION",
      emailVerified: false,
      phoneVerified: false,
    });
    expect(body.meta.requestId).toBe(response.headers.get("x-request-id"));
    const customer = await db.customer.findFirstOrThrow({ include: { account: true } });
    expect(customer.preferredLocale).toBe("en");
    expect(customer.account?.email).toBe("sara@example.com");
  });

  it("returns VALIDATION_ERROR with stable issue codes", async () => {
    const response = await call(register, "/register", {
      body: {
        email: "sara@example.com",
        password: "passwordpassword",
        phone: "0101",
        fullName: "S",
      },
    });
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.issues.map((i: { code: string }) => i.code).sort()).toEqual([
      "password_common",
      "phone_invalid",
    ]);
  });

  it("rejects a cross-site Origin", async () => {
    const response = await call(register, "/register", {
      headers: { origin: "https://evil.example" },
      body: { email: "a@example.com", password: PASSWORD, phone: "01012345678", fullName: "A" },
    });
    expect(response.status).toBe(403);
  });
});

describe("cookie transport (website)", () => {
  it("logs in with HttpOnly cookies and no tokens in the body", async () => {
    await registerCustomer();
    const response = await call(login, "/login", {
      headers: { "x-auth-transport": "cookie", origin: SAME_ORIGIN },
      body: { email: "sara@example.com", password: PASSWORD },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.tokens).toBeUndefined();
    expect(body.data.account.email).toBe("sara@example.com");
    expect(body.data.session.expiresAt).toEqual(expect.any(String));

    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(
      new RegExp(`^${ACCESS_COOKIE}=bfa_.+; HttpOnly; Secure; SameSite=Lax$`),
    );
    expect(cookies[1]).toMatch(new RegExp(`^${REFRESH_COOKIE}=bfr_.+; Path=/api/v1/auth;`));
  });

  it("requires an allowed Origin to log in with cookies", async () => {
    await registerCustomer();
    for (const headers of <Record<string, string>[]>[
      { "x-auth-transport": "cookie" },
      { "x-auth-transport": "cookie", origin: "https://evil.example" },
    ]) {
      const response = await call(login, "/login", {
        headers,
        body: { email: "sara@example.com", password: PASSWORD },
      });
      expect(response.status).toBe(403);
    }
  });

  it("authenticates, refreshes and logs out with cookies behind the CSRF check", async () => {
    await registerCustomer();
    const signedIn = await call(login, "/login", {
      headers: { "x-auth-transport": "cookie", origin: SAME_ORIGIN },
      body: { email: "sara@example.com", password: PASSWORD },
    });
    let cookie = cookieHeader(signedIn);

    const current = await call(session, "/session", { method: "GET", headers: { cookie } });
    expect(current.status).toBe(200);

    const refreshed = await call(refresh, "/refresh", {
      headers: { cookie, origin: SAME_ORIGIN },
    });
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).data.tokens).toBeUndefined();
    cookie = cookieHeader(refreshed);

    const noOrigin = await call(logout, "/logout", { headers: { cookie } });
    expect(noOrigin.status).toBe(403);
    const foreign = await call(logout, "/logout", {
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);

    const loggedOut = await call(logout, "/logout", {
      headers: { cookie, referer: `${SAME_ORIGIN}/account` },
    });
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers.getSetCookie().every((c) => c.includes("Max-Age=0"))).toBe(true);

    const after = await call(session, "/session", { method: "GET", headers: { cookie } });
    expect(after.status).toBe(401);
  });
});

describe("Bearer transport (mobile)", () => {
  async function bearerLogin() {
    const response = await call(login, "/login", {
      body: { email: "sara@example.com", password: PASSWORD },
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    return (await response.json()).data.tokens as { accessToken: string; refreshToken: string };
  }

  it("returns tokens in the body and accepts them without Origin headers", async () => {
    await registerCustomer();
    const tokens = await bearerLogin();
    const auth = { authorization: `Bearer ${tokens.accessToken}` };

    const current = await call(session, "/session", { method: "GET", headers: auth });
    expect(current.status).toBe(200);
    expect((await current.json()).data.customer.phone).toBe("+201012345678");

    const refreshed = await call(refresh, "/refresh", {
      body: { refreshToken: tokens.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()).data.tokens;
    expect(next.refreshToken).not.toBe(tokens.refreshToken);

    const all = await call(logoutAll, "/logout-all", {
      headers: { authorization: `Bearer ${next.accessToken}` },
    });
    expect(all.status).toBe(204);
    expect(all.headers.getSetCookie()).toEqual([]);
  });

  it("changes the password", async () => {
    await registerCustomer();
    const tokens = await bearerLogin();
    const response = await call(changePassword, "/change-password", {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { currentPassword: PASSWORD, newPassword: "violet kettle on the balcony" },
    });
    expect(response.status).toBe(204);
    const old = await call(login, "/login", {
      body: { email: "sara@example.com", password: PASSWORD },
    });
    expect((await old.json()).error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });
});

describe("session validation (API contract §6.1)", () => {
  it("returns UNAUTHENTICATED without or with an invalid token", async () => {
    for (const headers of <Record<string, string>[]>[
      {},
      { authorization: "Bearer nope" },
      { authorization: "Basic x" },
    ]) {
      const response = await call(session, "/session", { method: "GET", headers });
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("refresh without a token is UNAUTHENTICATED", async () => {
    const response = await call(refresh, "/refresh");
    expect(response.status).toBe(401);
  });

  it("returns AUTH_EMAIL_NOT_VERIFIED (403) for an unverified email", async () => {
    await registerCustomer("sara@example.com", {});
    const response = await call(login, "/login", {
      body: { email: "sara@example.com", password: PASSWORD },
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("AUTH_EMAIL_NOT_VERIFIED");
  });

  it("lets a half-verified customer read the session endpoint", async () => {
    await registerCustomer("sara@example.com", { email: true });
    const response = await call(login, "/login", {
      body: { email: "sara@example.com", password: PASSWORD },
    });
    const { accessToken } = (await response.json()).data.tokens;
    const current = await call(session, "/session", {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(current.status).toBe(200);
    expect((await current.json()).data.account).toMatchObject({
      status: "PENDING_VERIFICATION",
      emailVerified: true,
      phoneVerified: false,
    });
  });
});

describe("per-IP login limit and forged forwarding headers", () => {
  const marker = globalThis as Record<symbol, unknown>;

  afterEach(() => {
    delete marker[CUSTOM_SERVER_MARKER];
  });

  it("cannot be bypassed by rotating X-Forwarded-For / X-Real-IP", async () => {
    // As behind server.mjs with no trusted proxies (the default).
    marker[CUSTOM_SERVER_MARKER] = true;
    for (let i = 0; i < 30; i++) {
      const response = await call(login, "/login", {
        headers: {
          [DIRECT_ADDRESS_HEADER]: "203.0.113.7",
          "x-forwarded-for": `198.51.100.${i}`,
          "x-real-ip": `192.0.2.${i}`,
        },
        body: { email: `guess${i}@example.com`, password: "wrong password here" },
      });
      expect(response.status).toBe(401);
    }
    const blocked = await call(login, "/login", {
      headers: { [DIRECT_ADDRESS_HEADER]: "203.0.113.7", "x-forwarded-for": "198.51.100.200" },
      body: { email: "someone@example.com", password: "wrong password here" },
    });
    expect(blocked.status).toBe(429);
    const { error } = await blocked.json();
    expect(error.code).toBe("AUTH_RATE_LIMITED");
    expect(error.details.retryAfterSeconds).toBeGreaterThan(0);

    const otherClient = await call(login, "/login", {
      headers: { [DIRECT_ADDRESS_HEADER]: "203.0.113.8" },
      body: { email: "someone@example.com", password: "wrong password here" },
    });
    expect(otherClient.status).toBe(401);
    expect(
      await db.rateLimitBucket.count({ where: { key: { startsWith: "login:ip:198." } } }),
    ).toBe(0);
  }, 60_000);
});
