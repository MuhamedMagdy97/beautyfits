import { REQUEST_ID_HEADER } from "@/server/http/request-id";
import { ok } from "@/server/http/response";
import type {
  EmployeeSessionInfo,
  EmployeeSignedIn,
  EmployeeView,
  LoginTicket,
} from "@/server/modules/auth/employee-auth-service";
import {
  authCookies,
  clearedAuthCookies,
  EMPLOYEE_COOKIES,
  employeeDeviceCookie,
} from "@/server/modules/auth/transport";

/** Response helpers shared by the /api/v1/employee-auth route handlers. */

function headersWithCookies(cookies: string[]): Headers {
  const headers = new Headers();
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return headers;
}

export function employeeViewBody(view: EmployeeView, session: EmployeeSessionInfo) {
  return {
    account: view.account,
    employee: view.employee,
    session: {
      expiresAt: session.expiresAt.toISOString(),
      idleTimeoutSeconds: session.idleTimeoutSeconds,
    },
  };
}

/**
 * Signed-in response (login on a trusted device, verify-otp, refresh).
 * Cookie transport: tokens, and a newly trusted device, only in HttpOnly
 * cookies. Bearer transport: in the body.
 */
export function employeeSignedInResponse(
  requestId: string,
  signedIn: EmployeeSignedIn,
  useCookies: boolean,
  now: Date,
): Response {
  const body = employeeViewBody(signedIn.view, signedIn.session);
  const device = signedIn.trustedDevice;
  if (useCookies) {
    const cookies = authCookies(signedIn.tokens, now, EMPLOYEE_COOKIES);
    if (device) {
      cookies.push(employeeDeviceCookie(device.token, device.expiresAt, now));
    }
    return ok(
      requestId,
      { ...body, ...(device ? { deviceTrustedUntil: device.expiresAt.toISOString() } : {}) },
      { init: { headers: headersWithCookies(cookies) } },
    );
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
    ...(device
      ? { deviceToken: device.token, deviceTrustedUntil: device.expiresAt.toISOString() }
      : {}),
  });
}

/** 202: a login code was emailed; finish with the ticket at verify-otp. */
export function loginTicketResponse(
  requestId: string,
  ticket: LoginTicket & { codeSent?: boolean },
): Response {
  return ok(
    requestId,
    {
      otpRequired: true,
      ...(ticket.codeSent === undefined ? {} : { codeSent: ticket.codeSent }),
      loginTicket: ticket.loginTicket,
      loginTicketExpiresAt: ticket.loginTicketExpiresAt.toISOString(),
      cooldownSeconds: ticket.cooldownSeconds,
    },
    { status: 202 },
  );
}

/** 204 No Content, optionally deleting the employee session cookies (not the device cookie). */
export function employeeNoContent(requestId: string, clearCookies: boolean): Response {
  const headers = clearCookies
    ? headersWithCookies(clearedAuthCookies(EMPLOYEE_COOKIES))
    : new Headers();
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 204, headers });
}
