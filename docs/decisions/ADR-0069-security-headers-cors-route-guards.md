# ADR-0069 — Browser-Security Headers, No CORS, Route-Guard Test

- **Status:** Accepted (TASK-061)
- **Date:** 2026-10-17
- **Relates to:** ADR-0013 (cookies, Origin/Referer CSRF check), ADR-0016 (RBAC), ADR-0021 (file serving CSP); Security Requirements §5, §6, §12; API §30

## Context

ADR-0013 left CORS and the remaining browser-security headers to TASK-061. The TASK-061 audit also needs a way to keep every new `/api/v1` route authorized without a manual review each time.

## Decision

1. **Headers.** `next.config.ts` sends on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation and payment off) and `Strict-Transport-Security: max-age=63072000; includeSubDomains` (browsers ignore it over plain HTTP). `x-powered-by` is turned off.
2. **No site-wide Content-Security-Policy yet.** Next.js inline scripts need a nonce set up by a proxy. That is left for the deployment task (TASK-066). `GET /files/{id}/content` keeps its own sandbox CSP (ADR-0021).
3. **No CORS.** The website calls the API from its own origin, and the mobile app is not a browser. The API sends no `Access-Control-Allow-*` headers, so browsers block cross-origin reads. Cross-origin writes are still refused by the Origin check (ADR-0013). A future cross-origin client needs a new decision.
4. **Route-guard test.** `src/app/api/v1/route-guards.test.ts` reads every `route.ts` file. Each handler must be wrapped in `withApi` and call a guard (`requireCustomer`, `requireEmployee`, `requireStaff`, `requirePermission`, `requireAnyPermission` or `cartOwner`). Routes under `admin/` must use a staff guard, and routes under `me/` must use `requireCustomer`. The only exceptions are the routes on its `PUBLIC_ROUTES` list, and each one records what protects it instead (rate limits, single-use tokens, public catalog data).

## Consequences

- A new route fails the unit tests until it is guarded, or listed as public with a reason.
- The test checks that a guard is called. It does not check which permission is used. The permission and ownership checks stay with each module's integration tests.
