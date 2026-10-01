# ADR-0015 — Employee login: email codes, trusted devices and staff sessions

- **Status:** Accepted (TASK-011)
- **Date:** 2026-10-01
- **Relates to:** ADR-0008, ADR-0013, ADR-0014; Business Spec Q158–Q161, Q163, Q165, R15, R24, R28, R29, R30; API Contract "TASK-011 Amendments"; DB Design "v1.2 TASK-011 Amendments"

TASK-011 adds the employee login. The business rules come from the spec: every employee, Owner and Admin included, signs in with email + password + an email code, and the device is then trusted for 30 days (R28); staff sessions last at most 12 hours and end after 60 minutes without activity, both Owner/Admin-configurable, and a password reset revokes every session (R29, Q163); email is the only code channel (R30); customer and employee logins with the same email are separate (R15). This ADR records the technical choices around them. It changes no business rule.

## 1. Two-step login with a login ticket

- `POST /employee-auth/login` checks the password. On a trusted device it signs the employee in (`200`). Otherwise it emails a 6-digit `EMPLOYEE_LOGIN` code and returns `202` with a **login ticket** (`bfl_` + 256 random bits).
- `POST /employee-auth/verify-otp` takes the ticket and the code. The code alone is never enough: without the ticket, someone who only knows the email could guess the code while the real employee is signing in, and skip the password.
- The ticket's SHA-256 is stored on the code's `otp_challenges` row (`grant_token_hash`, the column TASK-008 uses for the reset token). It is single use (`grant_used_at`).
- **The ticket is valid for 15 minutes** from the password check. Within that time `resend-otp` can send new codes (60 s cooldown, Q160). Each resend issues a new ticket with the same end time and the old ticket stops working. After 15 minutes the employee enters the password again.
- Code rules are those of ADR-0014: 5-minute codes (Q159), 5 attempts (Q158), send limits per email and IP (Q161), the per-IP wrong-code block.
- A code request is serialized per account (advisory lock), so two concurrent requests cannot leave two open tickets.

## 2. Trusted devices (R28)

- A correct code creates an `employee_trusted_devices` row with a new **device token** (`bfd_` + 256 random bits, only the SHA-256 stored) that expires **30 days** after the code. The 30 days are fixed: using the device does not extend them.
- The website receives the token as the cookie `__Secure-bfe_dt` (`HttpOnly; Secure; SameSite=Lax`, `Path=/api/v1/employee-auth`, `Max-Age` 30 days), so it is only sent to the employee auth endpoints. Bearer clients receive `deviceToken` in the body and send it back in the login body.
- Login skips the code only when the token matches an unexpired, unrevoked device **of the same employee**. Any other token (unknown, expired, revoked, another employee's, malformed) simply leads to the code step.
- Logout and logout-all end sessions but keep the device trusted; a password reset does too (R29 names sessions only). Revoking devices (for example on deactivation) belongs to employee management (TASK-012).

## 3. Staff sessions (R29)

- Sessions use the same tables, opaque tokens, 15-minute access tokens, rotation and reuse detection as customers (ADR-0013), with `domain = EMPLOYEE`.
- **Maximum lifetime:** `expires_at` = login + the configured maximum (default 12 hours). Refreshing never extends it.
- **Idle timeout:** a session is rejected when `last_used_at` is older than the configured idle time (default 60 minutes). Every accepted employee request counts as activity; `last_used_at` is written at most once a minute, so the timeout is exact to within a minute. **A refresh is not activity**: otherwise a browser that refreshes tokens in the background would keep an unattended session alive until the 12-hour limit.
- **Configurable values (Q163).** The service reads `StaffSessionSettings` through a provider that currently returns the R29 defaults. The `settings` table and its Owner/Admin screen come with TASK-004 (default settings) and TASK-057 (settings screen); they plug into this provider. The maximum is fixed when the session starts; the idle timeout applies as currently configured.
- A password reset revokes every session of the employee (`PASSWORD_RESET`, R29).

## 4. Separate from customer sessions (R15)

- Employee cookies have their own names: `__Host-bfe_at` (access) and `__Secure-bfe_rt` (refresh, `Path=/api/v1/employee-auth`). A person signed in as both customer and employee in one browser keeps two independent sessions.
- The employee guard reads only Bearer or the employee access cookie; a customer session there is `FORBIDDEN`, and an employee session on customer endpoints is `FORBIDDEN` (as already in ADR-0013).
- One-time codes are scoped to the account: a new code supersedes only earlier codes of the **same account**, and the customer code endpoints only accept codes of customer accounts. A customer and an employee sharing an email never use or cancel each other's codes.
- Employee send limits use their own keys (`otp:send:EMPLOYEE:<purpose>:<sha256(email)>`), so a customer's requests never block the employee's codes.

## 5. Throttling

- Employee login uses the R24 values with employee-only keys: 5 consecutive failures lock the email's employee login for 15 minutes (`employee-login:account:<sha256(email)>`), 30 failures from one IP in 15 minutes block that IP (`employee-login:ip:<ip>`). Unknown emails cost the same scrypt work.
- An inactive account or employee is revealed (`403 FORBIDDEN`) only after a correct password, as for customers.

## 6. Recovery

- `forgot-password` emails a `PASSWORD_RESET` code to an active employee, answering `202` the same way for any email (ADR-0014).
- `reset-password` takes `{ email, code, newPassword }` in one step, as listed in API §10. It sets the password and revokes every session in one transaction. It does not sign the employee in.

## 7. Emails

Employees have no stored language preference, so staff code emails carry Arabic first, then English (R14), in one message.

## Consequences

- No new dependency. Migration `employee_auth` adds `employees` and `employee_trusted_devices`.
- There is no way to create an employee through the API yet: invitations (`accept-invitation`, Q64) come with employee management (TASK-012), and the first Owner with the bootstrap (TASK-004).
- `requireEmployee` (`src/server/modules/auth/employee-guard.ts`) is the guard for admin endpoints; TASK-012 adds permission checks on top of it.
- `audit_logs` does not exist yet (TASK-013). Login, logout and reset events are logged through the structured logger without emails, codes or tokens.
