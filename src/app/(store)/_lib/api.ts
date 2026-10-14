/**
 * Storefront client of the BeautyFits API (TASK-058, ADR-0055). The website
 * uses the customer cookie transport (ADR-0013): tokens live only in HttpOnly
 * cookies, so this code never sees them.
 *
 * - An expired access token (15 minutes) is renewed once with the refresh
 *   cookie and the request retried; concurrent requests share one refresh.
 *   When the session has ended the call fails with `UNAUTHENTICATED`.
 * - Every request names the shopper's language (`Accept-Language`, R14) and,
 *   when the browser holds one, the guest cart token (`X-Guest-Cart-Token`,
 *   API §14). A cart response that returns a new `guestCartToken` is kept.
 */

export class StoreApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "StoreApiError";
  }
}

const REFRESH_PATH = "/api/v1/auth/refresh";
export const GUEST_CART_KEY = "bf_guest_cart";

/** The guest cart token kept in this browser, if any. Storage may be blocked. */
export function getGuestCartToken(): string | null {
  try {
    return localStorage.getItem(GUEST_CART_KEY);
  } catch {
    return null;
  }
}

export function setGuestCartToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(GUEST_CART_KEY, token);
    } else {
      localStorage.removeItem(GUEST_CART_KEY);
    }
  } catch {
    // Without storage the guest cart lasts for this page only.
  }
}

/** The page language set by the root layout from the language cookie. */
function pageLang(): "ar" | "en" {
  return document.documentElement.lang === "en" ? "en" : "ar";
}

let refreshing: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch(REFRESH_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-auth-transport": "cookie" },
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function send<T>(path: string, init: RequestInit, canRefresh: boolean): Promise<T> {
  const guestCart = getGuestCartToken();
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "accept-language": pageLang(),
        "x-auth-transport": "cookie",
        ...(guestCart ? { "x-guest-cart-token": guestCart } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new StoreApiError(0, "NETWORK_ERROR");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json().catch(() => null)) as {
    data?: T & { guestCartToken?: unknown };
    error?: { code?: string; details?: Record<string, unknown> };
  } | null;
  if (response.ok) {
    const token = body?.data?.guestCartToken;
    if (typeof token === "string" && token) {
      setGuestCartToken(token);
    }
    return body?.data as T;
  }
  const code = body?.error?.code ?? "INTERNAL_ERROR";
  if (code === "UNAUTHENTICATED" && canRefresh && (await refreshOnce())) {
    return send(path, init, false);
  }
  throw new StoreApiError(response.status, code, body?.error?.details ?? {});
}

/** Calls the API and returns `data`; failures throw `StoreApiError`. */
export function storeApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  return send<T>(path, init, true);
}

/** POST a JSON body. */
export function storePost<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  return storeApi<T>(path, {
    ...init,
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Where to go after sign-in: only a storefront path of this site. External
 * URLs, protocol-relative `//host`, backslash tricks and the dashboard/API are
 * refused (no open redirect).
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  if (/^\/(staff|api)(\/|\?|#|$)/.test(value)) {
    return "/";
  }
  return value;
}

/** Full-page move to sign-in, remembering where the customer was. */
export function redirectToLogin(reason: "expired" | "required"): void {
  const query = new URLSearchParams({
    reason,
    next: window.location.pathname + window.location.search,
  });
  window.location.replace(`/login?${query.toString()}`);
}
