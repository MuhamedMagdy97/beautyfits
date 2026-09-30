import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTrustedProxyMatcher,
  CUSTOM_SERVER_MARKER,
  DIRECT_ADDRESS_HEADER,
  getClientIp,
  normalizeIp,
  resolveClientIp,
} from "@/server/http/client-ip";

const noProxies = createTrustedProxyMatcher([]);
const proxies = createTrustedProxyMatcher(["10.0.0.0/8", "fd00::/8", "192.0.2.10"]);

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("normalizeIp", () => {
  it.each([
    [" 203.0.113.7 ", "203.0.113.7"],
    ["203.0.113.7:51234", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["[2001:DB8::1]:443", "2001:db8::1"],
    ["2001:db8::1", "2001:db8::1"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });

  it.each(["", "unknown", "300.1.1.1", "evil.example", null])("rejects %s", (input) => {
    expect(normalizeIp(input)).toBeNull();
  });
});

describe("resolveClientIp without trusted proxies (default)", () => {
  it("uses the direct address and ignores forged forwarding headers", () => {
    const forged = headers({ "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" });
    expect(resolveClientIp(forged, "203.0.113.7", noProxies)).toBe("203.0.113.7");
  });

  it("ignores forwarding headers from a peer that is not a configured proxy", () => {
    const forged = headers({ "x-forwarded-for": "198.51.100.1" });
    expect(resolveClientIp(forged, "203.0.113.7", proxies)).toBe("203.0.113.7");
  });

  it("returns null when the direct address is unknown", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.1" }), null, noProxies)).toBe(
      null,
    );
  });
});

describe("resolveClientIp behind trusted proxies", () => {
  it("takes the closest untrusted X-Forwarded-For hop", () => {
    // A client-forged first entry cannot win: the proxy appended the real peer.
    const h = headers({ "x-forwarded-for": "198.51.100.66, 203.0.113.7, 10.1.2.3" });
    expect(resolveClientIp(h, "10.0.0.5", proxies)).toBe("203.0.113.7");
  });

  it("matches IPv6 and single-address entries", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "2001:db8::7" }), "fd00::1", proxies)).toBe(
      "2001:db8::7",
    );
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "203.0.113.9" }), "192.0.2.10", proxies),
    ).toBe("203.0.113.9");
  });

  it("stops at a malformed hop and uses the last trusted address", () => {
    const h = headers({ "x-forwarded-for": "garbage, 10.9.9.9" });
    expect(resolveClientIp(h, "10.0.0.5", proxies)).toBe("10.9.9.9");
  });

  it("falls back to X-Real-IP when every forwarded hop is a proxy", () => {
    const h = headers({ "x-forwarded-for": "10.0.0.5", "x-real-ip": "203.0.113.8" });
    expect(resolveClientIp(h, "10.0.0.5", proxies)).toBe("203.0.113.8");
    expect(resolveClientIp(headers({}), "10.0.0.5", proxies)).toBe("10.0.0.5");
  });
});

describe("getClientIp", () => {
  const marker = globalThis as Record<symbol, unknown>;

  beforeAll(() => {
    // getEnv() validates the whole configuration on first use.
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/unit");
  });

  afterEach(() => {
    delete marker[CUSTOM_SERVER_MARKER];
  });

  function request(values: Record<string, string>): Request {
    return new Request("http://localhost/api/v1/auth/login", { headers: values });
  }

  it("is null without the custom server, even with a forged direct-address header", () => {
    expect(
      getClientIp(
        request({ [DIRECT_ADDRESS_HEADER]: "203.0.113.7", "x-forwarded-for": "1.2.3.4" }),
      ),
    ).toBeNull();
  });

  it("uses the direct address written by the custom server", () => {
    marker[CUSTOM_SERVER_MARKER] = true;
    expect(
      getClientIp(
        request({ [DIRECT_ADDRESS_HEADER]: "203.0.113.7", "x-forwarded-for": "1.2.3.4" }),
      ),
    ).toBe("203.0.113.7");
  });
});
