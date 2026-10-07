import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffApiError, staffApi } from "./api";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const unauthenticated = () => json(401, { error: { code: "UNAUTHENTICATED", details: {} } });

describe("staffApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the cookie transport and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { data: { ok: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(staffApi("/api/v1/x")).resolves.toEqual({ ok: 1 });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["x-auth-transport"]).toBe("cookie");
  });

  it("refreshes once on UNAUTHENTICATED and retries; parallel calls share the refresh", async () => {
    let refreshed = false;
    const fetchMock = vi.fn(async (path: string) => {
      if (path.endsWith("/refresh")) {
        refreshed = true;
        return json(200, { data: {} });
      }
      return refreshed ? json(200, { data: path }) : unauthenticated();
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(Promise.all([staffApi("/a"), staffApi("/b")])).resolves.toEqual(["/a", "/b"]);
    expect(fetchMock.mock.calls.filter(([p]) => p.endsWith("/refresh"))).toHaveLength(1);
  });

  it("fails with UNAUTHENTICATED when the refresh is refused", async () => {
    const fetchMock = vi.fn(async () => unauthenticated());
    vi.stubGlobal("fetch", fetchMock);
    await expect(staffApi("/a")).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh on other errors and keeps details", async () => {
    const fetchMock = vi.fn(async () =>
      json(403, { error: { code: "PERMISSION_DENIED", details: { requiredPermissions: ["X"] } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const error = await staffApi("/a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StaffApiError);
    expect(error).toMatchObject({
      code: "PERMISSION_DENIED",
      details: { requiredPermissions: ["X"] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(staffApi("/a")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });
});
