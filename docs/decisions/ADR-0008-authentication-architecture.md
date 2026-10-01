# ADR-0008 — Authentication architecture (first-party, session-based)

- **Status:** Accepted (TASK-002); amended by ADR-0013 (TASK-007: tokens, transport, CSRF, throttling store, client IP); implemented by TASK-007, TASK-008, TASK-010, TASK-011
- **Date:** 2026-09-30
- **Relates to:** Architecture §6, §27 ("Exact auth library"); API Contract §4, §5, §10; Security Requirements §1–§4, §12; DB Design §3.1

## Requirements (from source-of-truth documents)

- **Customers.** Phone is the primary identifier; email is verified by OTP at registration and used for recovery. Password rules: 12+ characters, a breached/common-password check, and no composition rules. Sessions last 30 days and are revocable. Customers can log out from all devices. Email/phone changes require re-authentication plus OTP to the new destination.
- **Employees.** A separate authorization domain. Login is email + password + OTP, and MFA is mandatory for Owner/Admin. Staff sessions are shorter/stricter and admin-configurable.
- **OTP.** 5-minute expiry, 60 s resend cooldown, 5 attempts then a temporary lock, rate-limited by email + IP + device, with abuse events logged.
- **Clients.** Website, Dashboard, and Mobile use one API with `Authorization: Bearer <access-token>` (API Contract §5). A refresh endpoint exists for each domain.
- **Identity model.** An `accounts` table (`account_type` = `CUSTOMER` | `EMPLOYEE`) holds the password hash, with `customers`/`employees` profiles (DB Design §3–§4).

## Options considered

1. **`next-auth` v4 (installed at the start of TASK-002).** Rejected. It is designed around OAuth providers and cookie sessions. Its Credentials provider only works with JWT sessions, which cannot be revoked server-side, so logout-from-all-devices cannot be enforced. It has no built-in email-OTP verification flow or MFA, no first-class Bearer-token support for a mobile client, and it assumes one user model, which conflicts with separate customer and employee domains and the documented `accounts` schema. v4 is in maintenance mode, and its successor (Auth.js v5) is still beta.
2. **Better Auth.** A capable library with DB sessions, an email-OTP plugin, 2FA, and bearer tokens. Rejected for now. It imposes its own table model (`user`/`session`/`account`/`verification`), which conflicts with the documented identity schema. Two separate domains would need two parallel instances. It also adds a large third-party surface to the most security-critical code path.
3. **First-party auth module on platform primitives.** **Chosen.**

## Decision

Build authentication as first-party backend modules (`src/server/modules/auth` for customers, `src/server/modules/employee-auth` for employees) sharing low-level primitives. Node's `crypto` provides the primitives, so no auth dependency is added.

- **Sessions are opaque, server-side, and revocable.**
  - Tokens are 256-bit values from `crypto.randomBytes`. Only a SHA-256 hash of each token is stored, so a database leak does not yield usable tokens.
  - Session rows reference the account, domain (customer/employee), creation time, last use, absolute expiry, revocation time, and coarse device/IP metadata.
  - Every authenticated request validates the session in the database. As a result, `logout`, `logout-all`, password reset, and employee deactivation take effect immediately.
  - The access/refresh token split, token lifetimes, and refresh-token rotation with reuse detection are specified in TASK-007 within the 30-day customer policy. Staff session lifetimes are specified in TASK-011.
- **Transport.** `Authorization: Bearer` for every client, as the contract requires. Whether the Website additionally stores the token in an `HttpOnly; Secure; SameSite` cookie, and the related CSRF protection, is decided in TASK-007 with TASK-061 (Security Requirements §12).
- **Separate domains.** Customer tokens are never accepted on employee endpoints, and the reverse holds too. Separate session scopes and middleware enforce this, together with the permission-based authorization from TASK-012.
- **Password hashing.** Node's built-in `crypto.scrypt`, a memory-hard KDF listed by OWASP, with per-hash random salt. The parameters are encoded in the stored hash so they can be upgraded later. TASK-007 may justify argon2id instead in an ADR amendment.
- **OTP.** 6-digit codes from `crypto.randomInt`. Only a hash is stored, bound to purpose and destination, and it is single-use. The spec's expiry, cooldown, attempt, and lockout limits are enforced server-side, with constant-time comparison.
- **MFA.** An employee login returns a challenge, and `/employee-auth/verify-otp` completes it. The session is issued only after the second factor succeeds.
- **Rate limiting.** Must be correct across multiple app instances, so it is not in-memory only. The store is chosen in TASK-007.
- **Audit.** Security events (login failures, lockouts, logout-all, MFA failures) are logged without secrets and audited where required (TASK-013).

## Consequences

- The project owns security-critical code. It requires thorough unit and integration tests (Test Strategy §7) and the TASK-061 security review.
- There is no vendor lock-in, and the documented schema is kept.
- Open business questions surfaced while designing this are recorded in `docs/tasks/TASK-002-project-foundation.md` (Open Items) for TASK-007/008/009/011.
