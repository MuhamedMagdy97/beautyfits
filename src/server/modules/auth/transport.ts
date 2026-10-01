import { AppError } from "@/server/errors/app-error";

/**
 * How tokens travel between clients and the API (ADR-0013). The same
 * endpoints serve both transports:
 *
 * - Bearer (mobile, default): tokens are returned in the JSON body and sent
 *   back as `Authorization: Bearer <access-token>`; the refresh token is sent
 *   in the refresh request body.
 * - Cookie (website): a request with `X-Auth-Transport: cookie` receives the
 *   tokens only as HttpOnly, Secure, SameSite=Lax cookies. Cookie-authenticated
 *   state-changing requests must come from an allowed Origin (CSRF check).
 */
export const AUTH_TRANSPORT_HEADER = "x-auth-transport";
export const ACCESS_COOKIE = "__Host-bf_at";
export const REFRESH_COOKIE = "__Secure-bf_rt";
/** The refresh cookie is only sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export type CredentialSource = "bearer" | "cookie" | "body";

export interface Credential {
  token: string;
  source: CredentialSource;
}

export function wantsCookieTransport(request: Request): boolean {
  return request.headers.get(AUTH_TRANSPORT_HEADER)?.trim().toLowerCase() === "cookie";
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = part.slice(0, index).trim();
    if (!cookies.has(name)) {
      cookies.set(name, part.slice(index + 1).trim());
    }
  }
  return cookies;
}

/**
 * The access token of a request: `Authorization: Bearer` first, then the
 * access cookie. A present but malformed Authorization header is returned as
 * an (invalid) bearer credential rather than silently falling back to the
 * cookie.
 */
export function getAccessCredential(request: Request): Credential | null {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
    return { token: match?.[1] ?? "", source: "bearer" };
  }
  const cookie = parseCookies(request.headers.get("cookie")).get(ACCESS_COOKIE);
  return cookie ? { token: cookie, source: "cookie" } : null;
}

/** The refresh token of a request: request body first, then the refresh cookie. */
export function getRefreshCredential(
  request: Request,
  bodyToken: string | undefined,
): Credential | null {
  if (bodyToken !== undefined) {
    return { token: bodyToken, source: "body" };
  }
  const cookie = parseCookies(request.headers.get("cookie")).get(REFRESH_COOKIE);
  return cookie ? { token: cookie, source: "cookie" } : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    return origin;
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * CSRF protection (ADR-0013) for state-changing requests.
 *
 * - `strict` (cookie-authenticated requests, and requests that ask for cookie
 *   transport): the Origin, or else the Referer, must be present and allowed.
 * - otherwise (Bearer clients such as the mobile app, which send no Origin):
 *   an Origin, when present, must still be allowed.
 *
 * Allowed origins come from AUTH_ALLOWED_ORIGINS; when that is empty only the
 * request's own origin is allowed.
 */
export function assertAllowedOrigin(
  request: Request,
  allowedOrigins: readonly string[],
  strict: boolean,
): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return;
  }
  const origin = requestOrigin(request);
  if (origin === null) {
    if (strict) {
      throw new AppError("FORBIDDEN", "Request origin could not be verified.");
    }
    return;
  }
  const allowed = allowedOrigins.length > 0 ? allowedOrigins : [new URL(request.url).origin];
  if (!allowed.includes(origin)) {
    throw new AppError("FORBIDDEN", "Request origin is not allowed.");
  }
}

function serializeCookie(
  name: string,
  value: string,
  options: { path: string; maxAgeSeconds: number },
): string {
  return [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, options.maxAgeSeconds)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** Set-Cookie values carrying a token pair (cookie transport). */
export function authCookies(tokens: IssuedTokens, now: Date): string[] {
  const seconds = (until: Date) => Math.floor((until.getTime() - now.getTime()) / 1000);
  return [
    serializeCookie(ACCESS_COOKIE, tokens.accessToken, {
      path: "/",
      maxAgeSeconds: seconds(tokens.accessTokenExpiresAt),
    }),
    serializeCookie(REFRESH_COOKIE, tokens.refreshToken, {
      path: REFRESH_COOKIE_PATH,
      maxAgeSeconds: seconds(tokens.refreshTokenExpiresAt),
    }),
  ];
}

/** Set-Cookie values that delete both auth cookies. */
export function clearedAuthCookies(): string[] {
  return [
    serializeCookie(ACCESS_COOKIE, "", { path: "/", maxAgeSeconds: 0 }),
    serializeCookie(REFRESH_COOKIE, "", { path: REFRESH_COOKIE_PATH, maxAgeSeconds: 0 }),
  ];
}
