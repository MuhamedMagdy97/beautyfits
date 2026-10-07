/**
 * Dashboard client of the BeautyFits API (TASK-052). The dashboard uses the
 * employee cookie transport (ADR-0013, ADR-0015): tokens live only in
 * HttpOnly cookies, so this code never sees them.
 *
 * An expired access token (15 minutes) is renewed once with the refresh
 * cookie and the request retried; concurrent requests share one refresh.
 * When the session itself has ended (12 h maximum, 60 min idle, logout,
 * deactivation), the call fails with `UNAUTHENTICATED` and the caller sends
 * the employee to the sign-in page.
 */

export class StaffApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "StaffApiError";
  }
}

const REFRESH_PATH = "/api/v1/employee-auth/refresh";

let refreshing: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch(REFRESH_PATH, { method: "POST", credentials: "same-origin" })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function send<T>(path: string, init: RequestInit, canRefresh: boolean): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-auth-transport": "cookie",
        ...init.headers,
      },
    });
  } catch {
    throw new StaffApiError(0, "NETWORK_ERROR");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; details?: Record<string, unknown> };
  } | null;
  if (response.ok) {
    return body?.data as T;
  }
  const code = body?.error?.code ?? "INTERNAL_ERROR";
  if (code === "UNAUTHENTICATED" && canRefresh && (await refreshOnce())) {
    return send(path, init, false);
  }
  throw new StaffApiError(response.status, code, body?.error?.details ?? {});
}

/** Calls the API and returns `data`; failures throw `StaffApiError`. */
export function staffApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  return send<T>(path, init, true);
}

/** POST a JSON body. */
export function staffPost<T>(path: string, body?: unknown): Promise<T> {
  return staffApi<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Full-page move to sign-in, remembering where the employee was. */
export function redirectToLogin(reason: "expired" | "signed-out"): void {
  const next = window.location.pathname + window.location.search;
  const query = new URLSearchParams({ reason });
  if (reason === "expired") {
    query.set("next", next);
  }
  window.location.replace(`/staff/login?${query.toString()}`);
}
