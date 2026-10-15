import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANONYMOUS_ID_KEY,
  GUEST_CART_KEY,
  getGuestCartToken,
  safeNextPath,
  storeApi,
  storePage,
  storePost,
  storeSend,
} from "./api";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const unauthenticated = () => json(401, { error: { code: "UNAUTHENTICATED", details: {} } });
const headersOf = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;

describe("storeApi", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the cookie transport and the page language, and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { data: { ok: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(storeApi("/api/v1/x")).resolves.toEqual({ ok: 1 });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("same-origin");
    expect(headersOf(fetchMock.mock.calls[0])).toMatchObject({
      "x-auth-transport": "cookie",
      "accept-language": "en",
    });
    expect(headersOf(fetchMock.mock.calls[0])["x-guest-cart-token"]).toBeUndefined();
  });

  it("keeps a returned guest cart token and sends it afterwards", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { data: { id: "c1", guestCartToken: "bfc_abc" } }))
      .mockResolvedValueOnce(json(200, { data: { id: "c1" } }));
    vi.stubGlobal("fetch", fetchMock);
    await storePost("/api/v1/cart/items", { variantId: "v", quantity: 1 });
    expect(storage.get(GUEST_CART_KEY)).toBe("bfc_abc");
    await storeApi("/api/v1/cart");
    expect(headersOf(fetchMock.mock.calls[1])["x-guest-cart-token"]).toBe("bfc_abc");
  });

  it("survives blocked storage", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(getGuestCartToken()).toBeNull();
  });

  it("refreshes once on UNAUTHENTICATED and retries; parallel calls share the refresh", async () => {
    let refreshed = false;
    const fetchMock = vi.fn(async (path: string) => {
      if (path.endsWith("/auth/refresh")) {
        refreshed = true;
        return json(200, { data: {} });
      }
      return refreshed ? json(200, { data: path }) : unauthenticated();
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(Promise.all([storeApi("/a"), storeApi("/b")])).resolves.toEqual(["/a", "/b"]);
    expect(fetchMock.mock.calls.filter(([p]) => p.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("fails with UNAUTHENTICATED when the refresh is refused (a guest)", async () => {
    const fetchMock = vi.fn(async () => unauthenticated());
    vi.stubGlobal("fetch", fetchMock);
    await expect(storeApi("/a")).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh on other errors and keeps details", async () => {
    const fetchMock = vi.fn(async () =>
      json(429, { error: { code: "AUTH_RATE_LIMITED", details: { retryAfterSeconds: 30 } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(storeApi("/a")).rejects.toMatchObject({
      code: "AUTH_RATE_LIMITED",
      details: { retryAfterSeconds: 30 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends one stable anonymous id per browser", async () => {
    const fetchMock = vi.fn(async () => json(200, { data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await storeApi("/a");
    await storeApi("/b");
    const first = headersOf(fetchMock.mock.calls[0] as unknown[])["x-anonymous-id"];
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(headersOf(fetchMock.mock.calls[1] as unknown[])["x-anonymous-id"]).toBe(first);
    expect(storage.get(ANONYMOUS_ID_KEY)).toBe(first);
  });

  it("returns a list with its pagination", async () => {
    const pagination = { page: 2, pageSize: 24, total: 30, totalPages: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { data: [1, 2], meta: { pagination } })),
    );
    await expect(storePage("/a")).resolves.toEqual({ data: [1, 2], pagination });
  });

  it("returns undefined for 204 and sends other methods with a JSON body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(storeSend("PATCH", "/a", { x: 1 })).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init).toMatchObject({ method: "PATCH", body: '{"x":1}' });
  });

  it("reports a network failure as NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(storeApi("/a")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });
});

describe("safeNextPath", () => {
  it("keeps storefront paths", () => {
    expect(safeNextPath("/cart?x=1")).toBe("/cart?x=1");
    expect(safeNextPath("/staffing-tips")).toBe("/staffing-tips");
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/staff",
    "/staff/orders",
    "/api/v1/me",
  ])("refuses %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});
