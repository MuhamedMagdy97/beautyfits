import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors/app-error";
import { generateToken, hashToken, isWellFormedToken } from "@/server/modules/auth/tokens";
import {
  ACCESS_COOKIE,
  assertAllowedOrigin,
  authCookies,
  clearedAuthCookies,
  EMPLOYEE_COOKIES,
  EMPLOYEE_DEVICE_COOKIE,
  employeeDeviceCookie,
  getAccessCredential,
  getEmployeeDeviceCookie,
  getRefreshCredential,
  parseCookies,
  REFRESH_COOKIE,
  wantsCookieTransport,
} from "@/server/modules/auth/transport";

const URL_BASE = "http://localhost/api/v1/auth/logout";

function request(headers: Record<string, string>, method = "POST"): Request {
  return new Request(URL_BASE, { method, headers });
}

function forbidden(fn: () => void): void {
  try {
    fn();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("FORBIDDEN");
  }
}

describe("tokens", () => {
  it("are 256-bit, prefixed and hashed with SHA-256", () => {
    const access = generateToken("access");
    const refresh = generateToken("refresh");
    expect(isWellFormedToken("access", access)).toBe(true);
    expect(isWellFormedToken("refresh", refresh)).toBe(true);
    expect(isWellFormedToken("access", refresh)).toBe(false);
    expect(generateToken("access")).not.toBe(access);
    expect(hashToken(access)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(access)).toBe(hashToken(access));
  });

  it("have distinct kinds for login tickets and trusted devices (TASK-011)", () => {
    expect(generateToken("login")).toMatch(/^bfl_[A-Za-z0-9_-]{43}$/);
    expect(isWellFormedToken("device", generateToken("device"))).toBe(true);
    expect(isWellFormedToken("device", generateToken("login"))).toBe(false);
  });
});

describe("credential extraction", () => {
  it("parses cookies", () => {
    expect(parseCookies("a=1; b=two; a=3").get("a")).toBe("1");
    expect(parseCookies(null).size).toBe(0);
  });

  it("prefers Authorization: Bearer over the access cookie", () => {
    const credential = getAccessCredential(
      request({ authorization: "Bearer abc", cookie: `${ACCESS_COOKIE}=xyz` }),
    );
    expect(credential).toEqual({ token: "abc", source: "bearer" });
  });

  it("uses the access cookie when there is no Authorization header", () => {
    expect(getAccessCredential(request({ cookie: `${ACCESS_COOKIE}=xyz` }))).toEqual({
      token: "xyz",
      source: "cookie",
    });
    expect(getAccessCredential(request({}))).toBeNull();
  });

  it("does not fall back to the cookie when Authorization is malformed", () => {
    expect(
      getAccessCredential(request({ authorization: "Basic abc", cookie: `${ACCESS_COOKIE}=x` })),
    ).toEqual({ token: "", source: "bearer" });
  });

  it("takes the refresh token from the body, else the refresh cookie", () => {
    const req = request({ cookie: `${REFRESH_COOKIE}=cookie-token` });
    expect(getRefreshCredential(req, "body-token")).toEqual({
      token: "body-token",
      source: "body",
    });
    expect(getRefreshCredential(req, undefined)).toEqual({
      token: "cookie-token",
      source: "cookie",
    });
  });

  it("reads only the employee cookies for the employee domain (R15)", () => {
    const req = request({
      cookie: `${ACCESS_COOKIE}=customer; ${EMPLOYEE_COOKIES.access}=employee; ${EMPLOYEE_COOKIES.refresh}=r; ${EMPLOYEE_DEVICE_COOKIE}=d`,
    });
    expect(getAccessCredential(req)).toEqual({ token: "customer", source: "cookie" });
    expect(getAccessCredential(req, EMPLOYEE_COOKIES)).toEqual({
      token: "employee",
      source: "cookie",
    });
    expect(getRefreshCredential(req, undefined, EMPLOYEE_COOKIES)).toEqual({
      token: "r",
      source: "cookie",
    });
    expect(getEmployeeDeviceCookie(req)).toBe("d");
    expect(getAccessCredential(request({ cookie: `${ACCESS_COOKIE}=c` }), EMPLOYEE_COOKIES)).toBe(
      null,
    );
  });

  it("detects the cookie transport header", () => {
    expect(wantsCookieTransport(request({ "x-auth-transport": "Cookie" }))).toBe(true);
    expect(wantsCookieTransport(request({}))).toBe(false);
  });
});

describe("auth cookies", () => {
  it("are HttpOnly, Secure, SameSite=Lax, with the right paths and lifetimes", () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const [access, refresh] = authCookies(
      {
        accessToken: "bfa_x",
        accessTokenExpiresAt: new Date(now.getTime() + 15 * 60_000),
        refreshToken: "bfr_y",
        refreshTokenExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
      },
      now,
    );
    expect(access).toBe(
      `${ACCESS_COOKIE}=bfa_x; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(refresh).toBe(
      `${REFRESH_COOKIE}=bfr_y; Path=/api/v1/auth; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it("have employee names and paths; the device cookie lasts 30 days", () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const [access, refresh] = authCookies(
      {
        accessToken: "bfa_x",
        accessTokenExpiresAt: new Date(now.getTime() + 15 * 60_000),
        refreshToken: "bfr_y",
        refreshTokenExpiresAt: new Date(now.getTime() + 12 * 3_600_000),
      },
      now,
      EMPLOYEE_COOKIES,
    );
    expect(access).toBe("__Host-bfe_at=bfa_x; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax");
    expect(refresh).toBe(
      "__Secure-bfe_rt=bfr_y; Path=/api/v1/employee-auth; Max-Age=43200; HttpOnly; Secure; SameSite=Lax",
    );
    expect(employeeDeviceCookie("bfd_z", new Date(now.getTime() + 30 * 86_400_000), now)).toBe(
      "__Secure-bfe_dt=bfd_z; Path=/api/v1/employee-auth; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("can be cleared", () => {
    for (const cookie of clearedAuthCookies()) {
      expect(cookie).toMatch(/=; Path=[^;]+; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
    }
  });
});

describe("assertAllowedOrigin (CSRF)", () => {
  const allowed = ["https://beautyfits.example"];

  it("ignores safe methods", () => {
    assertAllowedOrigin(request({ origin: "https://evil.example" }, "GET"), allowed, true);
  });

  it("accepts an allowed Origin, or an allowed Referer when Origin is missing", () => {
    assertAllowedOrigin(request({ origin: "https://beautyfits.example" }), allowed, true);
    assertAllowedOrigin(
      request({ referer: "https://beautyfits.example/account?x=1" }),
      allowed,
      true,
    );
  });

  it("rejects a foreign Origin in both modes", () => {
    forbidden(() =>
      assertAllowedOrigin(request({ origin: "https://evil.example" }), allowed, true),
    );
    forbidden(() =>
      assertAllowedOrigin(request({ origin: "https://evil.example" }), allowed, false),
    );
  });

  it("strict mode requires an Origin or Referer; lenient mode does not", () => {
    forbidden(() => assertAllowedOrigin(request({}), allowed, true));
    forbidden(() => assertAllowedOrigin(request({ origin: "null" }), allowed, true));
    assertAllowedOrigin(request({}), allowed, false);
  });

  it("allows only the request's own origin when no origins are configured", () => {
    assertAllowedOrigin(request({ origin: "http://localhost" }), [], true);
    forbidden(() => assertAllowedOrigin(request({ origin: "http://localhost:3001" }), [], true));
  });
});
