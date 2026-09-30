# ADR-0013 — Customer auth: tokens, transport, CSRF, throttling and client IP

- **Status:** Accepted (TASK-007). Amends ADR-0008.
- **Date:** 2026-09-30
- **Relates to:** ADR-0008; Business Spec Q156, Q157, Q162, Q164, R23–R27; API Contract §4, §5, §6.1, §10; Security Requirements §1, §12; DB Design "v1.2 TASK-007 Amendments"

ADR-0008 chose first-party, opaque, server-side sessions. It left these decisions to TASK-007: the access/refresh split and lifetimes, rotation and reuse detection, website cookie transport and CSRF, the rate-limit store, and the common-password check. This ADR records them. It changes no business rule. The business values it implements (R23–R27, Q156, Q162) are cited where they apply.

## 1. Tokens and sessions

- **Opaque tokens.** A token is 256 random bits (`crypto.randomBytes`) in base64url, with a kind prefix (`bfa_` access, `bfr_` refresh). Only the SHA-256 hash is stored, and every request is validated against the database (ADR-0008).
- **Two tables** replace the single-row design of DB v1.2:
  - `auth_sessions` holds one login on one device, i.e. one refresh-token family. It has an **absolute** expiry of 30 days from login (Q162, R23). Refreshing never extends it.
  - `auth_session_tokens` holds every issued access/refresh pair. Reuse detection must recognise every earlier refresh token of a family, not only the last one, so the history needs its own table.
- **Access token lifetime: 15 minutes**, capped at the session expiry.
- **Rotation.** Each refresh supersedes the current pair (`rotated_at`) and issues a new one. A superseded access token stops working immediately. A conditional update claims the pair, so of two concurrent refreshes with the same token exactly one wins.
- **Reuse detection.** A superseded refresh token presented again revokes the whole session (`REUSE_DETECTED`).
  - Exception: within **10 seconds** of the rotation, the request is only rejected (`UNAUTHENTICATED`) and the session stays alive.
  - Two browser tabs that refresh at the same moment would otherwise log the customer out. The window is short enough that a stolen token remains detectable.
- **Revocation** is immediate, because every request checks the database.
  - `LOGOUT` revokes one session and `LOGOUT_ALL` revokes all (Q164).
  - `PASSWORD_CHANGE` revokes all sessions except the current one (R23).
  - `PASSWORD_RESET` revokes all sessions (R23, TASK-008).
- **Guard outcomes** (API §6.1):
  - `UNAUTHENTICATED` for a missing, malformed, unknown, expired or revoked token, or an expired pending account.
  - `FORBIDDEN` for an employee-domain session, a `SUSPENDED`/`DEACTIVATED` account, or a `PENDING_VERIFICATION` account on an endpoint that requires `ACTIVE` (R26; `details.reason = ACCOUNT_PENDING_VERIFICATION`).
- `last_used_at` is written at most once a minute per session.

## 2. Transport: one set of endpoints for website and mobile

- **Bearer (mobile, default).** Login and refresh return the tokens in the JSON body. Clients send `Authorization: Bearer <access-token>` and put the refresh token in the refresh request body.
- **Cookie (website).** The client asks for this with the request header `X-Auth-Transport: cookie`. Tokens are then set only as cookies and never appear in the body:
  - `__Host-bf_at`: access token, `Path=/`.
  - `__Secure-bf_rt`: refresh token, `Path=/api/v1/auth`, so it is only sent to auth endpoints.
  - Both are `HttpOnly; Secure; SameSite=Lax`, with `Max-Age` equal to the token lifetime.
  - Refresh answers in the transport the refresh token arrived in. Logout and logout-all clear the cookies.
- Bearer takes precedence over the cookie. A malformed `Authorization` header never falls back to the cookie.
- `GET /auth/session` exists because a website with HttpOnly cookies cannot read its own token to know it is signed in.

## 3. CSRF protection (Origin/Referer check)

Unsafe methods (anything except GET/HEAD/OPTIONS) are checked against an allow-list, `AUTH_ALLOWED_ORIGINS`. When the list is empty, only the request's own origin is allowed.

- **Strict mode:** the request is authenticated by cookie, or it asks for cookie transport (login, cookie refresh). The `Origin` header, or else the `Referer`, must be present and allowed; otherwise `FORBIDDEN`. An `Origin: null` counts as missing.
- **Lenient mode:** everything else, e.g. Bearer clients and registration. An `Origin` that is present must still be allowed. Native apps send none.

`SameSite=Lax` is a second layer. Production must set `AUTH_ALLOWED_ORIGINS` when TLS terminates at a proxy, because the request URL the app sees may then be `http://`. TASK-061 reviews the remaining browser-security headers (Security Requirements §12).

## 4. Throttling store: PostgreSQL (`rate_limit_buckets`)

- **Why PostgreSQL:** no Redis. Limits must hold across every app instance on any hosting (ADR-0008 §Rate limiting), and the database is already the source of truth.
- **Mechanics:**
  - One row per key, updated by a single `INSERT … ON CONFLICT DO UPDATE`, so concurrent hits are never lost.
  - A bucket counts hits within a window, or counts consecutive hits when it has no window. When the count reaches the limit, the key is blocked until `blocked_until`.
- **Policies:**

| Key | Policy | Source |
|---|---|---|
| `login:account:<sha256(email)>` | 5 consecutive failures → blocked 15 min; reset on success and after the block | R24 |
| `login:ip:<ip>` | 30 failures in 15 min → blocked 15 min | R24 (threshold set here) |
| `register:ip:<ip>` | 10 registrations within an hour → blocked for 1 hour | this ADR |

- **Why 30 per IP:** Egyptian mobile carriers put many subscribers behind shared (CGNAT) addresses. A low per-IP limit would block innocent customers; the per-account lock carries the main brute-force protection.
- The account key is a hash of the normalized email, whether or not an account exists. Lockouts therefore reveal nothing about which emails are registered. Unknown emails also cost the same scrypt work as real ones (dummy verification).
- Expired rows are harmless. Scheduled cleanup comes with background jobs.
- TASK-008 reuses the same mechanism for the OTP limits (Q158–Q161).

## 5. Client IP: thin custom server + trusted proxies

- **The problem.** Next.js 16 route handlers cannot see the socket address (`request.ip` was removed in v15). The Next.js server copies the socket address into `X-Forwarded-For` only when the client did not send that header. A forged header would therefore replace the real address and bypass per-IP limits.
- **The server.** `server.mjs` is a thin custom Node server around the Next.js request handler.
  - It writes `req.socket.remoteAddress` into the internal header `x-beautyfits-direct-address`, replacing any client-supplied value.
  - It marks the process (`Symbol.for("beautyfits.customServer")`) so the app knows the header is genuine.
  - `npm run dev` and `npm start` run it.
- **Resolution** (`src/server/http/client-ip.ts`):
  - By default, the direct address is the client.
  - When `TRUSTED_PROXIES` (IPs/CIDRs, empty by default) contains the direct address, the resolver walks `X-Forwarded-For` from the right, skipping trusted proxies. It falls back to `X-Real-IP`, then to the proxy address.
  - Without the custom server the address is unknown. Such requests share one `unknown` bucket, which fails closed, and a warning is logged.
- **Consequence for hosting.** This requires a long-running Node.js server; serverless functions and Next.js standalone output are ruled out. This settles the rate-limit part of the open hosting question (Architecture §27). Production behind a load balancer or CDN must list it in `TRUSTED_PROXIES`.

## 6. Passwords

- **Policy (Q156).**
  - The password is NFKC-normalized, then measured in Unicode code points: 12 to 256 characters. 256 is only a denial-of-service guard.
  - There are no composition rules.
  - Existing passwords (login, current password) are only length-bounded, never policy-checked.
- **Common/breached list.** An offline, bundled list at `src/server/modules/auth/common-passwords.txt`, with no external service.
  - Built from the SecLists (MIT licence) files `xato-net-10-million-passwords-1000000.txt`, `Pwdb_top-1000000.txt` and `100k-most-used-passwords-NCSC.txt`.
  - Kept only entries of 12+ characters (shorter ones fail the length rule anyway), NFKC-normalized and lowercased: 72,972 entries, about 1 MB, loaded into memory on first use.
  - The check is case-insensitive. Rebuilding or extending the list is a data change, not a code change.
- **Hashing:** `crypto.scrypt`, N=2^16, r=8, p=2 (an OWASP-listed setting; 64 MiB and about 200 ms per hash), 16-byte salt, 32-byte key. The parameters are stored in the hash: `scrypt$N=…,r=…,p=…$salt$hash`. Tests inject cheaper parameters.

## 7. Registration and pending accounts (R25)

- Email and phone uniqueness applies only to verified identities. It is enforced with PostgreSQL partial unique indexes (Prisma `partialIndexes` preview feature):
  - `accounts(account_type, email) WHERE email_verified_at IS NOT NULL`
  - `customers(phone) WHERE phone_verified_at IS NOT NULL`
- Registrations for the same email or phone are serialized with transaction-scoped advisory locks.
- Replaced pending accounts are deleted together with their sessions. This is the only hard delete in the identity model: a pending account cannot place orders or hold any business history. A future task that lets a pending account create business records must revisit this.

## Consequences

- There is no new runtime dependency. JSZip, used once to edit the ledger, lives outside the project.
- **Deployment:**
  - Run `npm start` (the custom server), not `next start`.
  - Set `TRUSTED_PROXIES` and `AUTH_ALLOWED_ORIGINS` in production.
  - Standalone output is not used.
- TASK-008 plugs in OTP challenges, email/WhatsApp verification, activation and password reset (calling `revokeAccountSessions(…, "PASSWORD_RESET")`) without schema changes to these tables.
- `audit_logs` does not exist yet (TASK-013). Security events are logged through the structured logger without secrets until then.
