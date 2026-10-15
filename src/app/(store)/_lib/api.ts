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

export const ANONYMOUS_ID_KEY = "bf_anon_id";

/**
 * A random id for this browser (Q146, API "TASK-050 Amendments"), created
 * once and sent as `X-Anonymous-Id` so analytics can count guests without
 * naming them. Null when storage is blocked.
 */
export function getAnonymousId(): string | null {
  try {
    let id = localStorage.getItem(ANONYMOUS_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANONYMOUS_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
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

interface Envelope {
  data?: unknown;
  meta?: { pagination?: Pagination };
  error?: { code?: string; details?: Record<string, unknown> };
}

/** `meta.pagination` of a list response (API §6). */
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

async function send(path: string, init: RequestInit, canRefresh: boolean): Promise<Envelope> {
  const guestCart = getGuestCartToken();
  const anonymousId = getAnonymousId();
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
        ...(anonymousId ? { "x-anonymous-id": anonymousId } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new StoreApiError(0, "NETWORK_ERROR");
  }
  if (response.status === 204) {
    return {};
  }
  const body = (await response.json().catch(() => null)) as Envelope | null;
  if (response.ok) {
    const token = (body?.data as { guestCartToken?: unknown } | undefined)?.guestCartToken;
    if (typeof token === "string" && token) {
      setGuestCartToken(token);
    }
    return body ?? {};
  }
  const code = body?.error?.code ?? "INTERNAL_ERROR";
  if (code === "UNAUTHENTICATED" && canRefresh && (await refreshOnce())) {
    return send(path, init, false);
  }
  throw new StoreApiError(response.status, code, body?.error?.details ?? {});
}

/** Calls the API and returns `data`; failures throw `StoreApiError`. */
export async function storeApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await send(path, init, true)).data as T;
}

/** GET a list endpoint: `data` with `meta.pagination`. */
export async function storePage<T>(path: string): Promise<{ data: T; pagination: Pagination }> {
  const body = await send(path, {}, true);
  return {
    data: body.data as T,
    pagination: body.meta?.pagination ?? { page: 1, pageSize: 0, total: 0, totalPages: 0 },
  };
}

/** POST a JSON body. */
export function storePost<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  return storeSend<T>("POST", path, body, init);
}

/** Any method with an optional JSON body. */
export function storeSend<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Promise<T> {
  return storeApi<T>(path, {
    ...init,
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Records an analytics event (TASK-050); failures never bother the shopper. */
export function track(
  event: { eventType: "PRODUCT_VIEW"; productId: string } | { eventType: "CHECKOUT_STARTED" },
): void {
  storePost("/api/v1/analytics/events", event).catch(() => undefined);
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
