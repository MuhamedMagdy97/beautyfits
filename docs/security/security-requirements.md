# BeautyFits — Security Requirements v1.1

**Status:** Consolidated from existing source-of-truth documents (TASK-001)
**Sources:** `docs/product/business-spec.md`, `docs/product/user-flows.md`, `docs/architecture/system-architecture.md` (§6, §19, §20, §23, §25), `docs/database/database-design.md`, `docs/api/api-contract.md` (§4, §5, §30), `AGENTS.md`

This document collects security requirements already decided elsewhere. It introduces no new business rules. When it and a source document disagree, the source document wins and the conflict must be reported.

Security is a cross-cutting concern from the beginning, not a post-MVP feature (Architecture §23).

---

## 1. Customer Authentication

| Requirement | Source |
|---|---|
| Phone is the primary customer identifier; email is also stored and verified | Q41 |
| Phone is an Egyptian mobile number (010/011/012/015 + 8 digits), stored in E.164 | R27 |
| No phone OTP at registration; the account is ACTIVE once the email is verified by email OTP | R25, R30 |
| Pending registrations do not reserve email/phone; uniqueness applies to verified identities; a pending account expires after 24 hours | R25 |
| A customer with an unverified email cannot log in; | R26 |
| Email verification by OTP is required at account creation | Q42 |
| Duplicate (verified) email is rejected; the user is directed to login/recovery | Q151, R25 |
| Password: minimum 12 characters, long passphrases allowed, checked against common/breached passwords, no forced composition rules | Q156 |
| Passwords are stored as hashes only; never plaintext | DB §3.1 |
| Rate limiting + progressive controls + CAPTCHA when suspicious (CAPTCHA is a layer, not the only control) | Q157 |
| 5 consecutive failed password attempts block the account's login for 15 minutes (even with the correct password); 30 failed logins from one IP in 15 minutes block that IP for 15 minutes; CAPTCHA in TASK-061 | R24, ADR-0013 |
| Per-IP limits use the direct connection address; `X-Forwarded-For`/`X-Real-IP` are trusted only from configured proxies (`TRUSTED_PROXIES`) | ADR-0013 |
| Customer session lifetime: 30 days; sessions remain revocable | Q162 |
| Customer can log out from all devices (revokes active sessions) | Q164 |
| Sessions last 30 days from login (absolute); opaque tokens stored only as SHA-256; 15-minute access tokens; refresh-token rotation with reuse detection | Q162, R23, ADR-0013 |
| Password change keeps the current session and revokes all others | R23 |
| Website tokens only in `HttpOnly; Secure; SameSite=Lax` cookies; cookie-authenticated state-changing requests require an allowed Origin/Referer (CSRF) | ADR-0013 |
| Forgot-password uses email OTP; a password reset revokes all of the customer's sessions | User Flows §3.2, R23 |

### OTP rules

| Requirement | Source |
|---|---|
| OTP expires after 5 minutes | Q159 |
| Resend available after 60 seconds | Q160 |
| 5 attempts, then temporary wait/lock; abuse events logged | Q158 |
| Rate limit by email + IP + device where possible | Q161 |
| Enforced server-side: expiration, retry count, resend cooldown, abuse limits | API §10 |

## 2. Sensitive Account Changes

| Requirement | Source |
|---|---|
| Email change: re-authenticate, OTP to new email, notify the previous email | Q152 |
| Phone change: re-authenticate, OTP to new phone, notify via verified email | Q153 |
| Account deletion is deactivate/anonymize while retaining required order/audit/legal records | Q154 |

## 3. Guest Identity

| Requirement | Source |
|---|---|
| Guest orders are linked to an account only after OTP verification; phone match alone is never sufficient | Q8, Q43, Q44 |
| Guest order access uses a secure, non-guessable mechanism; order number alone never authorizes access | API §4 |
| Guest data kept for the order is not used for marketing without separate valid consent | Q155 |

## 4. Employee Authentication

| Requirement | Source |
|---|---|
| Employee authorization domain is separate from customers | Architecture §6 |
| Employee login: email + password + email OTP; a successful OTP trusts the device for 30 days | Q165, Business Spec R28 |
| Owner/Admin: same email OTP rule in v1 (no separate MFA factor yet) | Q165, Audit Correction 10, Business Spec R28 |
| Staff sessions: default 12 hours maximum and 60 minutes idle; admin-configurable; a staff password reset revokes all sessions | Q163, Business Spec R29 |
| Email is the only OTP channel in v1 | Business Spec R30 |
| Employees are invited by work email; access is deactivated, never hard-deleted when history exists | Q64, Q69 |

## 5. Authorization

| Requirement | Source |
|---|---|
| Permission-based authorization enforced in the backend; UI visibility is not security | Architecture §6 |
| Hierarchy: Owner/Admin create Managers and Employees; Managers create Employees only; Employees cannot assign roles | Q65 |
| Managers cannot escalate permissions beyond their scope or modify the permission model | API §25 |
| Custom roles with granular permissions, created by Owner/Admin | Q66, Q67 |
| Sensitive transitions by Managers can enter Pending Approval for Owner/Admin (persistent `approval_requests`) | Q76, Audit Correction 7 |
| Never trust client-supplied ownership identifiers | API §30 |

### Dedicated permissions for high-risk actions

`ADJUST_INVENTORY` (reason required, Q71/Q72), `EDIT_PRODUCT_PRICE` (Q73), `MANAGE_PRODUCT_MEDIA` (Q175), `MANAGE_MANUAL_REFUNDS` (reason + audit, Q77), `ADJUST_WALLET` (Owner/Admin only, Q78), `RECORD_COD_CONFIRMATION` (records phone COD confirmation event; audited, Business Spec R10), `CONFIRM_ORDER` (Q82), `START_PREPARING` (Q83), `MARK_READY_FOR_SHIPMENT` (Audit Correction 3), `MARK_AS_SHIPPED` (Q84), `CANCEL_ORDER` (reason required, Q86), `REQUEST_SHIPPING_CANCELLATION` (Q88). Full catalog and default roles: `docs/security/permission-catalog.md` (Business Spec R17–R19).

### Sensitive data visibility

| Data | Default access | Source |
|---|---|---|
| Cost price | Owner/Admin + Inventory Manager, via permission | Q68, Q74 |
| Customer phone/address, wallet, cost, profit | Permission-based with secure role defaults | Q80 |
| Audit logs | Owner/Admin only | Q79 |
| Settings | Owner/Admin only; critical settings need Owner/Admin approval | Q179, Q180 |

Public product responses never expose cost price or sensitive internal inventory quantities (API §13).

## 6. API Security

From API Contract §30:

- Never expose password hashes, OTP secrets, internal tokens, cost data, or hidden audit fields to unauthorized clients.
- Validate every request server-side and authorize before mutation.
- Rate-limit authentication, OTP, checkout, review/report, and public analytics endpoints.
- Verify provider webhook signatures; make webhook handlers idempotent.
- Use opaque identifiers where practical.
- Validate uploads and scan them before publication.
- Log security failures without secrets.
- Critical retryable writes (checkout, refunds, wallet operations, harmful-duplicate notifications, webhooks) require idempotency (API §9).

## 7. File Uploads

Uploaded files are untrusted input (AGENTS.md).

Pipeline (Architecture §20): authentication + permission → type/size/dimension validation → security/malware validation → object storage → metadata in PostgreSQL.

- Backend validation is required; frontend checks are not enough (Q176).
- `media_assets.scan_status` = `PENDING` | `SAFE` | `REJECTED` (DB §6).
- Binary data is not stored in PostgreSQL.

## 8. Audit Logging

| Requirement | Source |
|---|---|
| Record actor, action, entity type, entity ID, old/new value, reason when required, timestamp, correlation ID where useful | Q70, Architecture §19 |
| Audit is append-only / immutable from normal staff workflows | Q70, DB §20 |
| Critical settings changes record old value, new value, actor, timestamp | Q181 |
| Must be audited: price changes, stock adjustments, order status changes, permission changes, settings changes, refunds, wallet adjustments, return decisions, supplier decisions | Architecture §19 |

## 9. Logging & Privacy

- Never log passwords, OTP values, session tokens, payment secrets, or unnecessary sensitive customer data (AGENTS.md).
- Production debugging must be possible without exposing sensitive customer data in logs (Architecture §25).
- Marketing requires explicit opt-in; consent is never inferred from possessing an email/phone or placing an order (Q59, Q155).

## 10. Secrets & Infrastructure

- Never commit secrets, credentials, tokens, or production `.env` files (AGENTS.md). `.env*` is gitignored.
- Required: secret management, least privilege, database access restrictions, encrypted transport (Architecture §23).

## 11. Backup & Recovery

- Automated daily backups plus weekly backups with longer retention; encrypted, off-environment (Q182).
- Documented recovery plan and tested restores; a backup alone is not sufficient (Q183).

## 12. Open Items

Items the source documents leave to implementation tasks (not business decisions):
- Session/token mechanism and auth library (Architecture §27). **Architecture decided in TASK-002** (ADR-0008): no auth library, first-party opaque server-side revocable sessions, and Bearer transport. **Customer token lifetimes, rotation and website cookies decided in TASK-007** (ADR-0013). Staff sessions remain for TASK-011.
- Password hashing parameters: **decided in TASK-007** (ADR-0013: scrypt N=2^16, r=8, p=2).
- Log redaction is implemented by the shared logger (ADR-0006); callers must still avoid logging unnecessary personal data.
- CSRF for cookie-authenticated requests: **Origin/Referer check decided in TASK-007** (ADR-0013). CORS and the remaining browser-security headers: TASK-061.
- Malware scanning provider (TASK-016).
- Rate-limit thresholds for login and registration: **decided in TASK-007** (R24, ADR-0013). Others (checkout, analytics, review/report): TASK-061 and their own tasks.
