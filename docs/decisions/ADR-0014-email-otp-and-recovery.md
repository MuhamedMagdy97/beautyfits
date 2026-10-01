# ADR-0014 — One-time codes, local email delivery and password recovery

- **Status:** Accepted (TASK-008)
- **Date:** 2026-10-01
- **Relates to:** ADR-0008, ADR-0013; Business Spec Q42, Q158–Q161, R23, R30; User Flows §3.1, §3.2; API Contract "TASK-008 Amendments"; DB Design "v1.2 TASK-008 Amendments"

TASK-008 adds email verification codes, resend and password recovery. The business values come from the spec: 5 attempts per code (Q158), 5-minute expiry (Q159), 60-second resend cooldown (Q160), rate limits by email and IP (Q161), email as the only OTP channel and activation on email verification (R30), and every session revoked by a password reset (R23). This ADR records the technical choices around them. It changes no business rule.

## 1. Email delivery: a local mailbox until a provider is chosen

- No email provider is chosen yet (Architecture §27) and the owner runs the system locally for now.
- Callers depend on an `EmailSender` port (`src/server/email/email.ts`). The only transport writes each message as an `.eml` file into `MAIL_DIR` (default `.mail/`, git-ignored). Any mail client can open the file.
- A provider transport (SMTP or an HTTP API) replaces it later without changing callers. Choosing the provider is a separate decision.
- Recipient and subject are rejected if they contain CR or LF (header injection). Subjects use RFC 2047 so Arabic survives; bodies are base64 UTF-8.

## 2. Sending after commit

- A code is created inside the database work and emailed after it commits. A failed send is logged (without the address or code) and never undoes the committed change: the user asks for a new code after the cooldown.
- A background job queue does not exist yet; the send is awaited in the request. When the job system lands (Architecture §19), sends move to it.

## 3. Codes

- 6 digits from `crypto.randomInt`. Only `sha256("<challengeId>:<code>")` is stored, so equal codes never share a hash; comparison is constant-time.
- Stored in `otp_challenges` (one row per code sent). A new code for the same purpose and email supersedes every earlier open one, so only the newest code works.
- **Attempts (Q158).** Each check counts one attempt with a conditional update, so concurrent guesses cannot exceed 5. After 5 the code is dead and the user must request a new one; the resend cooldown and hourly cap below are the "temporary wait" of Q158.
- **Expiry (Q159).** 5 minutes after sending.
- A correct code is consumed and cannot be used again.

## 4. Send and verify limits (Q160, Q161)

Stored in `rate_limit_buckets` (ADR-0013 §4). Keys hash the email.

| Limit | Value |
|---|---|
| Resend cooldown, per purpose and email | 1 code per 60 s |
| Per purpose and email | 5 codes per hour |
| Per IP, all code requests | 20 per hour |
| Per IP, wrong or unknown codes | 30 in 15 minutes block the IP for 15 minutes |

Requests that start from an email (resend, forgot-password) answer `202 { cooldownSeconds: 60 }` whether or not an eligible account exists, and the email limits count either way, so the responses do not reveal which emails are registered. Registration sends its first code only if the email's limits allow; otherwise it still succeeds with `verificationCodeSent: false`.

## 5. Email verification activates the account (R30)

- A correct `EMAIL_VERIFICATION` code sets `email_verified_at`, sets `customers.phone_verified_at` (the phone becomes this account's and unique; R30 removed the phone OTP), and moves the account to `ACTIVE`.
- If another account verified the same email or phone first, the unique index fails and the answer is `409 CONFLICT` with `details.field`.
- Verification does not sign the customer in; the client logs in with the password next. This keeps one login path and avoids issuing a session from an unauthenticated code check.

## 6. Password recovery

- `forgot-password` sends a `PASSWORD_RESET` code only to an `ACTIVE` account with that verified email.
- `verify-recovery-otp` consumes the code and returns a single-use reset token (`bfp_` + 256 random bits, SHA-256 stored on the challenge) valid for **10 minutes**. Splitting code check and new password keeps the flow of User Flows §3.2 (enter code, then choose a password) without re-sending the code.
- `reset-password` claims the token with a conditional update, sets the new password (policy Q156) and revokes every session with reason `PASSWORD_RESET` (R23) in one transaction. It does not sign the customer in.
- It does not clear the R24 login lock; that lock expires on its own after 15 minutes.

## Consequences

- Locally, codes are read from `.mail/`. Production needs a provider decision before launch.
- `otp_challenges` already carries the purposes and channel needed by TASK-009/010/011, which reuse `issueOtpChallenge` and the limits above.
- Expired challenges and old rate-limit rows are not cleaned up yet (background-jobs task).
