# TASK-061 — Security Review & Abuse Controls

## Goal
Review authentication, authorization, rate limiting, OTP abuse, file uploads, secrets, PII logging, CORS/CSRF, session handling and sensitive permissions (roadmap Phase 13). Fix the real gaps with small, tested changes. Record the open owner decisions.

## Dependencies
All feature phases (TASK-001 → TASK-060).

## Source of Truth
- `docs/security/security-requirements.md`, `docs/security/permission-catalog.md`
- `docs/api/api-contract.md` §4, §6.1, §30
- ADR-0006 (logging), ADR-0008 (auth architecture), ADR-0013 (customer sessions, cookies, CSRF, throttling), ADR-0014 (OTP), ADR-0015 (employee auth), ADR-0016 (RBAC), ADR-0021 (uploads)

## Scope
- Audit every `src/app/api/v1/**/route.ts`. Each one must have a session guard, plus a permission or ownership check, or be on a public list with a recorded reason.
- Check rate limits, OTP limits, upload validation, CSRF/Origin, cookie flags, security headers, secrets and log redaction.
- Fix the gaps: browser-security headers and `x-powered-by` (none before); an automated route-guard test.
- Handle the items other tasks left to TASK-061 (see Open Items).

## Non-Goals
- Rewriting working subsystems (auth, RBAC, uploads, throttling).
- A site-wide Content-Security-Policy. It needs nonces from a proxy and goes with deployment (TASK-066).
- Choosing a CAPTCHA provider, review thresholds or content filters (owner decisions).

## Files / Modules
- `next.config.ts`: security headers, `poweredByHeader: false`
- `src/app/api/v1/route-guards.test.ts` (new): route-guard audit as a test
- `src/server/http/security-headers.test.ts` (new)
- `docs/decisions/ADR-0069-security-headers-cors-route-guards.md` (new), ADR README, `docs/security/security-requirements.md` §12, roadmap

## Business Rules
No new business rules. Every threshold below comes from an existing decision.

## API Changes
None to request or response bodies. Every response now also carries `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `Strict-Transport-Security`, and no longer carries `x-powered-by`.

## Database Changes
None. No migration.

## Security / Authorization — Audit Checklist

Status: ✅ meets the requirement · 🔧 fixed in this task · ⚠️ open (see Open Items)

| # | Item | Requirement source | Status | Evidence |
|---|---|---|---|---|
| 1 | Every `/api/v1` handler is wrapped in `withApi` and calls a guard, or is on the reviewed public list | API §30, Arch §6 | 🔧 test added (all 204 route files pass) | `src/app/api/v1/route-guards.test.ts` |
| 2 | `admin/**` routes use a staff guard (`requirePermission` / `requireAnyPermission` / `requireEmployee`), never the customer guard | Security Req §5, permission catalog | ✅ (now enforced by test) | `src/server/modules/rbac/authorization.ts:107,125,142` |
| 3 | Owner/Admin-only permissions never reach Manager/Employee, whatever the role says | Permission catalog §2 | ✅ | `src/server/modules/rbac/catalog.ts:222`; `authorization.ts` `permissionsForLevel` |
| 4 | High-risk routes use their dedicated permission (`ADJUST_WALLET`, `VIEW_AUDIT_LOGS`, `SETTINGS_MANAGE`, `MARKETING_APPROVE`, `PURCHASE_APPROVE`, `ROLE_MANAGE`, `APPROVAL_RESOLVE`, `EDIT_COST_PRICE`) | Security Req §5 | ✅ | `admin/customers/[id]/wallet/adjust`, `admin/audit-logs`, `admin/settings/[key]`, `admin/campaigns/[id]/approve`, `admin/purchases/[id]/approve`, `admin/roles`, `admin/approval-requests/[id]/approve`, `admin/variants/[id]/cost` route files |
| 5 | Customer resources check ownership in the service (customer id from the session, never from the client) | API §30, Security Req §5 | ✅ | `orders-service.ts:450` (`findFirst {id, customerId}`); `returns-service.ts:676`; `reviews-service.ts:260`; `notifications-service.ts:229`; `wishlist-service.ts:186`; return evidence `lockEvidence(tx, customerId, …)` |
| 6 | `me/**` routes use `requireCustomer` | API §4 | ✅ (enforced by test) | `route-guards.test.ts` |
| 7 | Guest cart uses an opaque token; a signed-in caller always gets their own cart | API §14 | ✅ | `src/server/modules/cart/http.ts:20-26` |
| 8 | Public file serving: only `SAFE` files; non-public files need staff with the purpose permission; unknown and private answer alike | ADR-0021 | ✅ | `src/app/api/v1/files/[id]/content/route.ts:23-35` |
| 9 | Uploads: session + permission, single-use hashed token, expiry, size counted while streaming, type from content, dimensions, scan | Security Req §7, ADR-0021 | ✅ | `uploads-service.ts:380-427`; `media/schemas.ts:11,14`; `media/scanner.ts` |
| 10 | Served files use `nosniff` and a sandbox CSP | ADR-0021 | ✅ | `files/[id]/content/route.ts:48-49` |
| 11 | Login: 5 failures lock the account for 15 min; 30 failures per IP in 15 min block the IP | R24, ADR-0013 | ✅ | `src/server/modules/auth/policy.ts:30-41` |
| 12 | Registration per-IP limit | ADR-0013 | ✅ | `policy.ts:44` |
| 13 | OTP: 6 digits from `randomInt`, SHA-256, constant-time compare, 5 min TTL, 5 attempts, 60 s cooldown, 5/h per purpose+email, 20/h per IP, 30 wrong per IP / 15 min | Q158–Q161, ADR-0014 | ✅ | `src/server/modules/auth/otp.ts:20-58,76,86` |
| 14 | Resend / forgot-password give the same answer whether or not the account exists | ADR-0014 | ✅ | `verification-service.ts:141` |
| 15 | Employee login: R24 values on employee keys; ticket + OTP; trusted device token hashed | ADR-0015 | ✅ | `policy.ts:83-84`; `employee-auth-service.ts:243,324-325,427` |
| 16 | Invitation acceptance per-IP limit | ADR-0016 | ✅ | `rbac/employees-service.ts:735-742` |
| 17 | Checkout per-IP limit | API §30 | ✅ | `checkout-service.ts:60` (20/h) |
| 18 | Public analytics per-IP limit | API §30, ADR-0044 | ✅ | `analytics-service.ts:30` (1000/h) |
| 19 | COD secure link per-IP limit; discount-code guessing; guest cart creation | R10, ADR-0035 | ✅ | `cod-service.ts:48`; `cart-service.ts:59,66` |
| 20 | Review create/edit and report rate limits | API §30, TASK-044 | ⚠️ [BUSINESS DECISION REQUIRED] | `docs/api/api-contract.md:2029` |
| 21 | CAPTCHA as an extra layer when activity looks suspicious | Q157 | ⏸ Deferred (owner 2026-10-18): localhost only for now (BD-068) | — |
| 22 | Per-IP keys use the socket address; `X-Forwarded-For` only from `TRUSTED_PROXIES` | ADR-0013 | ✅ | `src/server/http/client-ip.ts:125`; `server.mjs` |
| 23 | Cookies: `__Host-`/`__Secure-` prefixes, `HttpOnly; Secure; SameSite=Lax`, refresh/device cookies scoped to the auth paths | ADR-0013, ADR-0015 | ✅ | `src/server/modules/auth/transport.ts:15-45,155-167` |
| 24 | CSRF: cookie-authenticated state-changing requests need an allowed Origin/Referer; pre-auth endpoints check a present Origin | ADR-0013 | ✅ | `transport.ts:134`; `guard.ts:36-38`; `employee-guard.ts:37-38`; every `auth/*` and `employee-auth/*` route |
| 25 | CORS | Security Req §12 | 🔧 decided: none (ADR-0069) | `next.config.ts`; `security-headers.test.ts` |
| 26 | Browser-security headers (`nosniff`, frame denial, Referrer-Policy, Permissions-Policy, HSTS); hide `x-powered-by` | Security Req §12, ADR-0013 | 🔧 added | `next.config.ts` |
| 27 | API responses not cached | API §7 | ✅ | `src/server/http/response.ts:25`; `auth/http.ts:67` |
| 28 | Sessions: opaque tokens stored as SHA-256; 15-min access; refresh rotation with reuse detection; revocation; staff idle timeout | ADR-0013, ADR-0015, R29 | ✅ | `auth/tokens.ts:47`; `auth-service.ts:494`; `employee-auth-service.ts:76,182` |
| 29 | Passwords: scrypt, 12+ characters, common-password list | Q156, ADR-0013 | ✅ | `auth/password-hash.ts:5`; `auth/password-policy.ts`; `common-passwords.txt` |
| 30 | Logs: sensitive keys and secrets in text redacted; access log has the path only (no query) | ADR-0006, Security Req §9 | ✅ | `src/server/logging/logger.ts:19-40`; `route-handler.ts:33` |
| 31 | Logs carry no OTP values, emails or phones: callers log account/challenge ids only | Security Req §9 | ✅ | `otp.ts:344-356`; `verification-service.ts:141,178,260`; `profile-service.ts:216,360,431` |
| 32 | Unhandled errors return a generic `INTERNAL_ERROR`; details go to the log only | API §6.1 | ✅ | `route-handler.ts:44-56` |
| 33 | Secrets: `.env*` gitignored (only `.env.example` tracked); no keys in source | AGENTS.md | ✅ | `.gitignore:43-44`; `git ls-files` check |
| 34 | Job scripts print raw errors with `console.error` (not through the redacting logger) | ADR-0006 | ⚠️ low; follow-up | `scripts/*.ts` (`console.error(error)`) |
| 35 | Dependency advisories (`npm audit --omit=dev`) | ADR-0002 | ✅ fixed | Was: `next@16.3.5` in the advisory range 16.0.0–16.3.7 (critical: next/og RCE, image-optimizer SSRF, ISR cache poisoning). The app uses neither `next/og` nor `next/image`, but the fix is 16.3.8 (same minor). Upgraded to 16.3.8 on 2026-10-17 (owner approval). Prisma tooling (`mysql2`, `deepmerge-ts`), `sharp`, `source-map-js`: dev/build tooling, tracked as ADR-0002 says |
| 36 | Website: when a refresh is refused, the dead access cookie is not cleared | ADR-0055 ("TASK-061 may") | ⚠️ optional follow-up | `src/app/api/v1/auth/refresh/route.ts` |

## Acceptance Criteria
- [x] Audit checklist recorded with source and evidence.
- [x] Each route is guarded, or listed as public with a reason, and a test enforces it.
- [x] Security headers set and tested; CORS policy recorded (ADR-0069).
- [x] Open owner decisions recorded below, not decided in code.

## Tests
- `src/app/api/v1/route-guards.test.ts`: enumerates all `route.ts` files and checks the guard rules (one test case per route).
- `src/server/http/security-headers.test.ts`: header set, no `Access-Control-*`, `poweredByHeader: false`.
- Existing integration tests already cover the throttles, OTP, CSRF and ownership.

## Edge Cases
- A route that guards inside a shared helper (`files/upload-init` → `uploadActor`) still counts one guard call per handler.
- `files/[id]/content` is public only for images of published or archived products. Its fallback to `requireStaff` satisfies the guard test.
- `X-Frame-Options` and the HSTS header from the config are also sent on API responses, which is harmless. The sandbox CSP of `files/[id]/content` is not overridden, because the config sets no CSP.

## Open Items
- [BUSINESS DECISION REQUIRED] Rate-limit thresholds for review create/edit and review report (API §30; TASK-044, ADR-0042). Not applied. Still open after the owner decision of 2026-10-18 (BD-060): Security Requirements require these limits.
- Resolved (owner decision 2026-10-18): keep current behaviour — no review content filters (BD-059).
- Deferred (owner 2026-10-18): localhost only for now — CAPTCHA (Q157) needs a provider account and keys (BD-068).
- ~~Upgrade `next` / `eslint-config-next` 16.3.5 → 16.3.8~~ Done 2026-10-17 (owner approved). Still re-check Prisma tooling advisories before production (ADR-0002).
- Site-wide Content-Security-Policy with nonces: TASK-066 (deployment).
- Low: route the job scripts' errors through the logger (`scripts/*.ts`). Optional: clear the website auth cookies when a refresh is refused (ADR-0055).

## Definition of Done
Required checks green (lint, format, typecheck, unit, integration, build); docs updated; committed on `feature/TASK-061-security-review`.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
