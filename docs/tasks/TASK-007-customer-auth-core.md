# TASK-007 — Customer Authentication Core

## Goal
Customers can register (the account starts as `PENDING_VERIFICATION`), log in with email + password, refresh, log out, log out of all devices and change their password. Sessions are opaque, server-side and revocable. Login and registration are throttled. A reusable session-validation guard protects customer endpoints.

## Dependencies
TASK-006 (CI baseline). Followed by TASK-008 (OTP, email + WhatsApp verification, account activation, forgot/reset password).

## Source of Truth
- Business Spec Q41, Q42, Q151, Q156, Q157, Q162, Q164, R13, R15; new R23–R26 (this task)
- User Flows §3.1, §3.2
- Architecture §6
- Database Design v1.2 §3.1, §3.2, "v1.2 TASK-002A Amendments → Authentication"
- API Contract §4, §5, §6.1, §10, §29, §30
- Security Requirements §1
- ADR-0008 (amended by ADR-0013, this task)

## Product-owner decisions (2026-09-30)
- **R23** Password reset revokes all of the customer's sessions. Password change (while logged in) keeps the current session and revokes all others.
- **R24** 5 failed password attempts on an account → login for that account is blocked for 15 minutes. Also a per-IP limit (threshold proposed by this task). CAPTCHA comes later (TASK-061).
- **R25** The phone is verified by a WhatsApp OTP at registration. The account becomes `ACTIVE` only after both email and phone are verified. WhatsApp is also the OTP channel for phone change and guest-order claim (closes the TASK-002A open decision 3).
- **R26** A customer whose email is not verified cannot log in.

## Scope
- Tables `accounts`, `customers`, `auth_sessions`, `auth_session_tokens`, `rate_limit_buckets` (+ migration).
- Password policy (Q156) with a bundled offline common/breached password list; scrypt hashing.
- Endpoints: `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/auth/change-password`, `GET /auth/session`.
- Opaque access token + 30-day refresh token, rotation and reuse detection.
- Website cookie transport (HttpOnly/Secure/SameSite=Lax) with an Origin/Referer CSRF check; Bearer for mobile.
- Session-validation guard (`UNAUTHENTICATED` / `FORBIDDEN`, API §6.1).
- Throttling stored in PostgreSQL.
- Client IP from the direct connection (thin custom server `server.mjs`); forwarding headers only from `TRUSTED_PROXIES`.
- Registration replaces unverified pending accounts; pending accounts expire after 24 hours (R25).
- Docs: business spec R23–R27, ledger rows, ADR-0013, DB design, API contract, security requirements, user flows, architecture, README.

## Non-Goals
- OTP challenges, email/WhatsApp sending, email/phone verification, account activation, forgot/reset password, resend cooldown (TASK-008). `otp_challenges` is designed in the DB document but not migrated.
- Profile, addresses, email/phone change (TASK-009); guest-order claim (TASK-010); employee auth (TASK-011).
- `audit_logs` persistence (TASK-013): security events are logged through the structured logger for now.
- CAPTCHA (TASK-061); scheduled cleanup of expired sessions/throttle rows (background-jobs task).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/<ts>_customer_auth_core/`
- `src/server/modules/auth/**`: `auth-service.ts`, `sessions.ts`, `tokens.ts`, `password-policy.ts`, `password-hash.ts`, `common-passwords.txt`, `identifiers.ts`, `schemas.ts`, `transport.ts` (cookies/CSRF), `guard.ts`, `http.ts`, `policy.ts`
- `src/server/rate-limit/rate-limit.ts`; `src/server/http/client-ip.ts`, `locale.ts`; `validation.ts` (`parseOptionalJsonBody`, custom issue codes)
- `src/app/api/v1/auth/{register,login,refresh,logout,logout-all,change-password,session}/route.ts`
- `server.mjs`, `package.json` (`dev`/`start` scripts)
- `src/server/config/env.ts` (`TRUSTED_PROXIES`, `AUTH_ALLOWED_ORIGINS`), `.env.example`
- `src/server/errors/app-error.ts` (new code `AUTH_EMAIL_NOT_VERIFIED`)

## Business Rules
R23–R27 (above and in `docs/product/business-spec.md`) and the owner answers under **Open Items**.

## API Changes
API Contract §5, §6.1, §10, §11, §12, §29 and "TASK-007 Amendments": new `POST /auth/change-password` and `GET /auth/session`, request/response shapes, `X-Auth-Transport: cookie`, error code `AUTH_EMAIL_NOT_VERIFIED` (403), WhatsApp channel for phone change / guest claim.

## Database Changes
Migration `customer_auth_core`: `accounts`, `customers`, `auth_sessions`, `auth_session_tokens`, `rate_limit_buckets`, verified-only partial unique indexes. Recorded in Database Design ("v1.2 TASK-007 Amendments"); migration strategy note in ADR-0003.

## Security / Authorization
Security Requirements §1; ADR-0008/ADR-0013. Tokens stored as SHA-256 only; constant-time comparisons; no secrets in logs; enumeration-resistant login.

## Acceptance Criteria
- Registration creates an account in `PENDING_VERIFICATION` with a scrypt hash; weak/common/short passwords are rejected; a **verified** duplicate email or phone → `CONFLICT` (Q151); an unverified pending account is replaced (R25).
- Login fails with `AUTH_INVALID_CREDENTIALS` for unknown email or wrong password (same response, similar timing); with `AUTH_EMAIL_NOT_VERIFIED` only after a correct password on an unverified email (R26); with `FORBIDDEN` for suspended/deactivated accounts.
- 5 consecutive failed attempts block the account's login for 15 minutes (`AUTH_RATE_LIMITED`); the per-IP limit applies and cannot be bypassed with forged forwarding headers (R24).
- Refresh rotates both tokens; a reused refresh token revokes the whole session (`REUSE_DETECTED`).
- Logout revokes the current session; logout-all revokes every session of the customer; change-password keeps the current session and revokes the others (R23).
- Guard: missing/invalid/expired/revoked token → `UNAUTHENTICATED`; employee-domain session or suspended/deactivated account → `FORBIDDEN`.
- Cookie-authenticated unsafe requests without an allowed Origin/Referer → `FORBIDDEN`.
- All required checks pass.

## Tests
- Unit: password policy, scrypt hash/verify, token generation/hashing, cookie/CSRF helper, client-IP resolution, input schemas.
- Integration (PostgreSQL): register, login, lockout, per-IP limit, refresh rotation and reuse detection, logout, logout-all, change-password, guard outcomes, concurrent throttle increments.
- Route tests: envelopes, status codes, cookie vs bearer transport.

## Edge Cases
- Email case/whitespace normalization; same email as an employee account (R15).
- Concurrent refresh from two browser tabs (grace window).
- Login during lockout with the correct password (still blocked).
- Refresh after absolute session expiry.

## Definition of Done
Acceptance criteria met, checks green, docs updated, PR opened (not merged).

## Open Items
Plan review by the product owner (2026-09-30):

- **Answered — pending registrations do not reserve identifiers (owner, plan review change 1).** Email and phone uniqueness applies only to verified identities (partial unique indexes on `accounts(account_type, email) WHERE email_verified_at IS NOT NULL` and `customers(phone) WHERE phone_verified_at IS NOT NULL`). A `PENDING_VERIFICATION` account expires 24 hours after creation. A new registration with the same email or phone replaces the unverified pending account instead of returning `CONFLICT`. Q151 (reject duplicate email → login/recovery) applies to verified identities.
- **Answered — client IP (owner, plan review change 2).** `X-Forwarded-For` / `X-Real-IP` are trusted only when the request comes through a configured trusted proxy (env setting, off by default); otherwise the direct connection address is used. Tested so a forged header cannot bypass the per-IP limit.
- **Answered — R27 phone format (owner, plan review change 3).** Egyptian mobile numbers only (010, 011, 012, 015 + 8 digits), stored as E.164 (`+20…`). Accepted inputs: `01xxxxxxxxx`, `+201xxxxxxxxx`, `00201xxxxxxxxx`. No new dependency.
- **Answered — stale pending registrations (plan item 6).** Covered by change 1.
Follow-up answers (owner, 2026-09-30):

- **Answered — half-verified login.** A customer whose email is verified but whose phone is not (account still `PENDING_VERIFICATION`, within 24 hours) can log in with limited access: only the session/auth endpoints of this task (and the verification endpoints of TASK-008). Every other customer endpoint returns `FORBIDDEN` until the account is `ACTIVE`.
- **Answered — session lifetime.** Absolute: a session (refresh-token family) ends 30 days after login, regardless of activity (Q162).
- **Answered — "5 failed attempts" (R24).** 5 consecutive failures. The counter resets on successful login and after the 15-minute block ends. During the block even the correct password is refused. Wrong current passwords in change-password also count.
- **Answered — `fullName`.** Required, trimmed, 1–100 characters. `preferredLocale` comes from the body, else `Accept-Language`, else `ar`.
- **Answered — pending account with verified email.** Only fully unverified pending accounts are replaced by a new registration. A half-verified account keeps its verified email; both accounts may hold the same unverified phone and whichever verifies the phone first gets it (partial unique index). An expired pending account (24 hours) is treated as non-existent and is replaced whatever its verification state.
- **Answered — direct connection address.** Next.js 16 route handlers cannot see the socket address. A thin custom Node server (`server.mjs`) writes the socket address into an internal header (removing any client-supplied copy); production runs it instead of `next start` (ADR-0013). This implies a long-running Node server (no serverless / standalone output).

No open items remain for TASK-007.

## Status
- [x] Planned
- [x] In Progress
- [ ] Tests Passing
- [ ] Reviewed
- [ ] Done
