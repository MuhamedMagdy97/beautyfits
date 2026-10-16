import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("security headers (TASK-061, ADR-0069)", () => {
  it("applies the browser-security headers to every path and hides x-powered-by", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");
    const headers = Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));

    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    expect(headers["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);
    // No CORS: cross-origin browser reads of the API stay blocked.
    expect(
      Object.keys(headers).some((key) => key.toLowerCase().startsWith("access-control-")),
    ).toBe(false);
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
