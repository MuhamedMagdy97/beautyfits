# TASK-011 — Employee Authentication & Email Code

## Goal
Every employee, Owner and Admin included, signs in with email + password + an email code. After a correct code the device is trusted for 30 days and later logins on it need only the password. Staff sessions last at most 12 hours and end after 60 minutes without activity. Employees can refresh, log out, log out everywhere and reset a forgotten password; a reset signs out every session.

## Dependencies
TASK-006 (CI baseline). Reuses TASK-007 (sessions, tokens, transport, throttling) and TASK-008 (codes, local mailbox). Followed by TASK-012 (roles, permissions, invitations).

## Source of Truth
- Business Spec Q64, Q69, Q158–Q161, Q163, Q165, R14, R15, R24, R28, R29, R30
- User Flows §17
- Architecture §6 "Employees", §23
- Database Design §4, "v1.2 TASK-007 Amendments" (`employee_trusted_devices`), "v1.2 TASK-011 Amendments"
- API Contract §4, §10, "TASK-011 Amendments"
- Security Requirements §4
- ADR-0013, ADR-0014; ADR-0015 (this task)

## Product-owner decisions (2026-10-01, R28–R31)
- Email code for every employee, re-verified every 30 days per device; no extra Owner/Admin factor in v1 (R28).
- Staff session: 12 hours maximum, 60 minutes idle, Owner/Admin-configurable; a staff password reset revokes all sessions (R29).
- Email is the only code channel; emails go to the local `.mail/` folder until a provider is chosen (R30, ADR-0014).

## Scope
- Tables `employees`, `employee_trusted_devices` (+ migration `employee_auth`).
- Endpoints: `POST /employee-auth/login`, `/verify-otp`, `/resend-otp`, `/refresh`, `/logout`, `/logout-all`, `/forgot-password`, `/reset-password`, and `GET /employee-auth/session`.
- Login ticket binding the code to the password step; trusted-device token (cookie for the website, body for Bearer clients).
- Staff session maximum and idle timeout read through a settings provider (R29 defaults).
- Employee guard `requireEmployee` for admin endpoints.
- Separate employee cookies, code scoping and send-limit keys so a customer and an employee sharing an email never interfere (R15).
- Bilingual (Arabic, then English) staff code emails.

## Non-Goals
- Roles, permissions, permission checks, employee invitations and `accept-invitation`, employee management and device revocation (TASK-012).
- Creating the first Owner (TASK-004 bootstrap).
- The `settings` table and the Owner/Admin screen for the session lengths (TASK-004 defaults, TASK-057).
- `audit_logs` (TASK-013): events go to the structured logger for now.
- Email provider; background jobs; cleanup of expired rows; CAPTCHA (TASK-061).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261001151055_employee_auth/`
- `src/server/modules/auth/employee-auth-service.ts`, `employee-guard.ts`, `employee-http.ts`; changes in `otp.ts` (account-scoped codes, `attemptOtpCode`, employee send keys, staff email), `transport.ts` (employee cookies), `tokens.ts` (`bfl_`, `bfd_`), `policy.ts`, `schemas.ts`, `verification-service.ts` (customer codes only)
- `src/app/api/v1/employee-auth/{login,verify-otp,resend-otp,refresh,logout,logout-all,session,forgot-password,reset-password}/route.ts`

## Business Rules
R28, R29, R15 as above. Technical defaults (no business change) in ADR-0015: the 15-minute login ticket, refresh is not activity, R24 throttling values reused with employee keys, logout and reset keep devices trusted, bilingual staff emails.

## API Changes
API Contract "TASK-011 Amendments": request/response shapes, new `GET /employee-auth/session`, cookies, errors.

## Database Changes
Migration `employee_auth`. Database Design "v1.2 TASK-011 Amendments".

## Security / Authorization
Password, then code bound to a single-use ticket; codes, tickets, device and session tokens stored only as hashes; device trust is per employee and expires after 30 days; idle and maximum session limits enforced on every request and refresh; customer and employee sessions never cross domains; no emails, codes or tokens in logs.

## Acceptance Criteria
- A new device gets an emailed code; the correct code signs in and trusts the device for 30 days; on that device the password alone signs in; after 30 days the code is required again. Owner and Admin follow the same rule.
- The code alone never signs in; codes expire after 5 minutes, allow 5 attempts, can be resent after 60 s; the ticket expires 15 minutes after the password check.
- A session ends 12 hours after login and after 60 minutes without activity; configured values are applied.
- A customer token is refused on employee endpoints and the reverse; a deactivated employee is refused.
- Logout and logout-all revoke sessions; a password reset revokes every session.
- All required checks pass.

## Tests
- Integration: `employee-auth-service.int.test.ts` (code step, trusted device and its expiry, other employee's device, Owner/Admin, throttling, deactivation, attempts, expiry, resend and ticket rotation, ticket window, single use, idle and maximum session, configured settings, cross-domain, refresh rotation and reuse, logout, recovery, shared email with a customer, no secrets in logs).
- Route tests: `employee-auth-routes.int.test.ts` (cookie flow with device cookie, CSRF, Bearer flow with device token, attempts and resend, domain separation, recovery).
- Unit: employee cookies and tokens, bilingual staff email.

## Edge Cases
- Re-entering the password within 60 s of a code: `429` with `retryAfterSeconds` (the code already sent still works with its ticket).
- A customer and an employee with the same email: separate codes, separate limits, separate cookies.
- Refresh during an idle period is refused once the idle timeout has passed.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- No way to create an employee through the API yet: the first Owner comes with TASK-004 and invitations with TASK-012.
- The session lengths are the R29 defaults until the settings store exists (TASK-004/TASK-057).

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
