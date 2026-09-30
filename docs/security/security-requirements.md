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
| Email verification by OTP is required at account creation | Q42 |
| Duplicate email is rejected; the user is directed to login/recovery | Q151 |
| Password: minimum 12 characters, long passphrases allowed, checked against common/breached passwords, no forced composition rules | Q156 |
| Passwords are stored as hashes only; never plaintext | DB §3.1 |
| Rate limiting + progressive controls + CAPTCHA when suspicious (CAPTCHA is a layer, not the only control) | Q157 |
| Customer session lifetime: 30 days; sessions remain revocable | Q162 |
| Customer can log out from all devices (revokes active sessions) | Q164 |
| Forgot-password uses email OTP; existing sessions handled according to security policy | User Flows §3.2 |

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
| Employee login: email + password + OTP | Q165 |
| Owner/Admin: mandatory MFA | Q165, Audit Correction 10 |
| Staff sessions: admin-configurable with safer (shorter/stricter) defaults than customer sessions | Q163 |
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

`ADJUST_INVENTORY` (reason required, Q71/Q72), `EDIT_PRODUCT_PRICE` (Q73), `MANAGE_PRODUCT_MEDIA` (Q175), `MANAGE_MANUAL_REFUNDS` (reason + audit, Q77), `ADJUST_WALLET` (Owner/Admin only, Q78), `RECORD_COD_CONFIRMATION` (records phone COD confirmation event; audited, Business Spec R10), `CONFIRM_ORDER` (Q82), `START_PREPARING` (Q83), `MARK_READY_FOR_SHIPMENT` (Audit Correction 3), `MARK_AS_SHIPPED` (Q84), `CANCEL_ORDER` (reason required, Q86), `REQUEST_SHIPPING_CANCELLATION` (Q88). Full catalog: API Contract.

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
- Session/token mechanism and auth library (Architecture §27). **Architecture decided in TASK-002** (ADR-0008): no auth library, first-party opaque server-side revocable sessions, and Bearer transport. Token lifetimes/rotation and cookie usage for the Website remain for TASK-007/TASK-011.
- Password hashing algorithm parameters (ADR-0008 default: Node `crypto.scrypt`; TASK-007).
- Log redaction is implemented by the shared logger (ADR-0006); callers must still avoid logging unnecessary personal data.
- CSRF/CORS policy (TASK-061).
- Malware scanning provider (TASK-016).
- Exact rate-limit thresholds other than the OTP rules above (TASK-007, TASK-061).
