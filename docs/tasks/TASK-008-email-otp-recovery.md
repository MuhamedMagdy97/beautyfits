# TASK-008 — Email OTP & Recovery

## Goal
A new customer verifies their email with a 6-digit code and the account becomes `ACTIVE`. Customers can request a new code, and recover a forgotten password with an emailed code. Codes expire, have limited attempts, a resend cooldown and abuse limits.

## Dependencies
TASK-007 (customer authentication core).

## Source of Truth
- Business Spec Q42, Q156, Q158–Q161, R23, R30
- User Flows §3.1, §3.2
- Architecture §6, §19, §27
- Database Design §3 `otp_challenges`, "v1.2 TASK-007 Amendments"
- API Contract §5 (Customer), §29, "TASK-007 Amendments"
- Security Requirements §1
- ADR-0013; ADR-0014 (this task)

## Product-owner decisions (2026-10-01)
- Every OTP is sent by email, for every role (R30, R31). SMS/WhatsApp are not used for now.
- The customer account becomes `ACTIVE` once the email is verified; the phone is saved but not verified with a code (R30).
- Run locally for now.

## Scope
- Table `otp_challenges` (+ migration `otp_challenges`).
- Email port with a local `.eml` mailbox transport (`MAIL_DIR`).
- Registration emails the verification code.
- Endpoints: `POST /auth/verify-email-otp`, `/auth/resend-otp`, `/auth/forgot-password`, `/auth/verify-recovery-otp`, `/auth/reset-password`.
- Bilingual (ar/en) code emails in the customer's preferred language (R14).

## Non-Goals
- An email provider (SMTP/API) — separate decision; local mailbox only.
- Email/phone change (TASK-009), guest-order claim (TASK-010), employee login OTP and trusted devices (TASK-011).
- Background job queue and cleanup of expired challenges.
- CAPTCHA (TASK-061).

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/20261001125345_otp_challenges/`
- `src/server/email/email.ts`
- `src/server/modules/auth/otp.ts`, `verification-service.ts`, `auth-service.ts` (register sends the code), `tokens.ts` (`bfp_` reset token), `schemas.ts`
- `src/app/api/v1/auth/{verify-email-otp,resend-otp,forgot-password,verify-recovery-otp,reset-password}/route.ts`
- `src/server/config/env.ts` (`MAIL_DIR`), `.env.example`, `.gitignore`, `.prettierignore`

## Business Rules
Q42, Q158–Q161, R23, R30 as above. Technical defaults (no business change) are in ADR-0014: superseding older codes, the hourly/IP send caps, the IP verify limit, the 10-minute reset token, and that verification and reset do not sign the customer in.

## API Changes
API Contract "TASK-008 Amendments": request/response shapes, `verificationCodeSent` on register, errors.

## Database Changes
Migration `otp_challenges`. Database Design "v1.2 TASK-008 Amendments".

## Security / Authorization
Codes and reset tokens stored only as hashes; constant-time comparison; attempts counted atomically; enumeration-resistant resend/forgot; emails, codes and tokens never logged; header injection rejected in emails.

## Acceptance Criteria
- Registration emails a 6-digit code; a failed send keeps the registration.
- The correct code verifies the email and activates the account; the customer can then log in.
- Wrong code → `AUTH_OTP_INVALID` with `attemptsRemaining`; after 5 attempts the code no longer works (Q158).
- A code expires after 5 minutes → `AUTH_OTP_EXPIRED` (Q159).
- A new code can be requested after 60 seconds and replaces the old one (Q160); email and IP limits apply (Q161).
- Resend and forgot-password answer the same for unknown emails.
- Recovery: code → single-use reset token → new password; every session is revoked (R23).
- All required checks pass.

## Tests
- Unit: email encoding and header injection, code generation/hashing, schemas, config.
- Integration: `verification-service.int.test.ts` (activation, attempts, expiry, reuse, cooldown, hourly and IP caps, enumeration, phone conflict, recovery and session revocation, single-use/expired reset token, no secrets in logs).
- Route tests: full verify → login → recover flow reading the code from the local mailbox; status codes and error envelopes.

## Edge Cases
- Pending account expired after 24 h → code rejected as expired.
- Another account verifies the same phone first → `409 CONFLICT`, `details.field = phone`.
- Recovery code cannot verify an email and vice versa.
- Concurrent guesses cannot exceed the attempt limit; a reset token cannot be used twice.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- Email provider for staging/production (not a TASK-008 blocker; ADR-0014 §1).

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
