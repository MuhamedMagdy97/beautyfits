import type { NextConfig } from "next";

/**
 * Browser-security headers on every response (TASK-061, ADR-0069). No
 * site-wide Content-Security-Policy yet: Next.js inline scripts need a nonce
 * setup; `GET /files/{id}/content` sets its own sandbox CSP (ADR-0021).
 * No CORS headers: the website calls the API from its own origin and the
 * mobile app is not a browser, so cross-origin browser reads stay blocked.
 */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Ignored by browsers over plain HTTP (local development).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  poweredByHeader: false,
  headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
