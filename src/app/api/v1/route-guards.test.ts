import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TASK-061 route audit, kept as a test: every /api/v1 handler is wrapped in
 * `withApi` and checks a session (or a cart owner) before doing work, unless
 * its route is on the explicit public list below with the reason it may run
 * without one. A new route fails here until it is guarded or listed.
 */

const ROOT = join(process.cwd(), "src", "app", "api", "v1");

const GUARD_CALL =
  /\b(requireCustomer|requireEmployee|requireStaff|requirePermission|requireAnyPermission|cartOwner)\(/g;
const STAFF_GUARD_CALL =
  /\b(requireEmployee|requireStaff|requirePermission|requireAnyPermission)\(/;
const HANDLER_EXPORT = /export const (GET|POST|PUT|PATCH|DELETE) = withApi\b/g;

/** Routes that run without a session, and what protects them instead. */
const PUBLIC_ROUTES: Record<string, string> = {
  "[[...path]]": "unknown-path 404 fallback, does nothing",
  health: "liveness probe, no data",
  "health/ready": "readiness probe, no data",
  "auth/register": "pre-auth; per-IP limit (ADR-0013)",
  "auth/login": "pre-auth; per-account and per-IP limits (R24, ADR-0013)",
  "auth/refresh": "the refresh token is the credential; rotation with reuse detection",
  "auth/resend-otp": "pre-auth; OTP send limits (ADR-0014)",
  "auth/verify-email-otp": "pre-auth; OTP attempt and per-IP limits (ADR-0014)",
  "auth/forgot-password": "pre-auth; OTP send limits, same answer for unknown emails (ADR-0014)",
  "auth/verify-recovery-otp": "pre-auth; OTP attempt and per-IP limits (ADR-0014)",
  "auth/reset-password": "single-use 10-minute reset token (ADR-0014)",
  "employee-auth/login": "pre-auth; employee R24 limits (ADR-0015)",
  "employee-auth/verify-otp": "login ticket + OTP attempt and per-IP limits (ADR-0015)",
  "employee-auth/resend-otp": "login ticket + OTP send limits (ADR-0015)",
  "employee-auth/refresh": "the refresh token is the credential",
  "employee-auth/forgot-password": "pre-auth; OTP send limits (ADR-0015)",
  "employee-auth/reset-password": "OTP attempt and per-IP limits (ADR-0015)",
  "employee-auth/accept-invitation": "single-use invitation token, per-IP limit (ADR-0016)",
  "files/uploads/[id]": "single-use upload token (ADR-0021)",
  "orders/[orderId]/confirm-cod": "secure-link token, per-IP limit (R10)",
  brands: "public catalog",
  categories: "public catalog",
  locations: "public delivery areas",
  products: "public catalog (no cost or internal stock, API §13)",
  "products/[productId]": "public catalog (no cost or internal stock, API §13)",
  "products/[productId]/reviews": "published reviews only",
  "shipping/free-shipping-threshold": "public setting",
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(path);
    }
    return entry.name === "route.ts" ? [path] : [];
  });
}

const routes = routeFiles(ROOT).map((file) => ({
  route: relative(ROOT, file).split(sep).slice(0, -1).join("/"),
  source: readFileSync(file, "utf8"),
}));

describe("API route guards (TASK-061)", () => {
  it("finds the route files", () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it.each(routes)("$route checks a session or is explicitly public", ({ route, source }) => {
    const handlers = source.match(HANDLER_EXPORT)?.length ?? 0;
    const guards = source.match(GUARD_CALL)?.length ?? 0;
    if (route in PUBLIC_ROUTES) {
      expect(guards, `${route} is public; remove it from PUBLIC_ROUTES`).toBe(0);
      return;
    }
    expect(handlers, `${route} exports no withApi handler`).toBeGreaterThan(0);
    // One guard call per handler (a shared helper may hold it, as in files/upload-init).
    expect(guards, `${route}: every handler must call a guard`).toBeGreaterThanOrEqual(handlers);
  });

  it.each(routes.filter((r) => r.route.startsWith("admin/")))(
    "$route uses a staff guard",
    ({ source }) => {
      expect(source).toMatch(STAFF_GUARD_CALL);
      expect(source).not.toMatch(/\brequireCustomer\(/);
    },
  );

  it.each(routes.filter((r) => r.route === "me" || r.route.startsWith("me/")))(
    "$route uses the customer guard",
    ({ source }) => {
      expect(source).toMatch(/\brequireCustomer\(/);
    },
  );

  it("lists only existing routes as public", () => {
    const existing = new Set(routes.map((r) => r.route));
    expect(Object.keys(PUBLIC_ROUTES).filter((route) => !existing.has(route))).toEqual([]);
  });
});
