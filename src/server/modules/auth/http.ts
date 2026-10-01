import type { ApiContext } from "@/server/http/route-handler";
import { getClientIp } from "@/server/http/client-ip";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";
import { ok } from "@/server/http/response";
import type { AccountView, RequestMeta, SignedIn } from "@/server/modules/auth/auth-service";
import { authCookies, clearedAuthCookies } from "@/server/modules/auth/transport";

/** Response helpers shared by the /api/v1/auth route handlers. */

export function requestMeta(request: Request, api: ApiContext): RequestMeta {
  return {
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent"),
    logger: api.logger,
    requestId: api.requestId,
  };
}

function cookieHeaders(cookies: string[]): Headers {
  const headers = new Headers();
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return headers;
}

export function viewBody(view: AccountView, sessionExpiresAt?: Date) {
  return {
    account: view.account,
    customer: view.customer,
    ...(sessionExpiresAt ? { session: { expiresAt: sessionExpiresAt.toISOString() } } : {}),
  };
}

/**
 * Login/refresh response. Cookie transport: tokens only in HttpOnly cookies.
 * Bearer transport: tokens in the body.
 */
export function signedInResponse(
  requestId: string,
  signedIn: SignedIn,
  useCookies: boolean,
  now: Date,
): Response {
  const body = viewBody(signedIn.view, signedIn.sessionExpiresAt);
  if (useCookies) {
    return ok(requestId, body, {
      init: { headers: cookieHeaders(authCookies(signedIn.tokens, now)) },
    });
  }
  const { tokens } = signedIn;
  return ok(requestId, {
    ...body,
    tokens: {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
    },
  });
}

/** 204 No Content, optionally deleting the auth cookies. */
export function noContent(requestId: string, clearCookies: boolean): Response {
  const headers = clearCookies ? cookieHeaders(clearedAuthCookies()) : new Headers();
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 204, headers });
}
