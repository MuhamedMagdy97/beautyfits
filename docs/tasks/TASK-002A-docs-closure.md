# TASK-002A — Documentation Closure v1.2

## Goal
Resolve the contradictions and gaps found by the post-TASK-002 documentation/code audit (2026-09-30) so the source-of-truth documents are complete and consistent enough to implement TASK-003 onward. Documentation only.

## Dependencies
TASK-002 (merged, PR #2).

## Source of Truth
- `AGENTS.md`
- All documents under `docs/product`, `docs/architecture`, `docs/database`, `docs/api`, `docs/security`, `docs/testing`, `docs/tasks`
- `docs/decisions/business-rules-ledger.xlsx` (decision history)

## Non-Goals
- No application code, no schema/migration, no dependency changes.
- No new business rule is invented: every business-level change below cites an owner decision recorded in this file (section "Owner Decisions") or stays open as `[BUSINESS DECISION REQUIRED]`.

## Owner Decisions (recorded 2026-09-30)

D-01 to D-04 were answered directly by the owner. D-05 to D-07 were delegated by the owner ("choose the most suitable") and set to the recommended option; all can be revised.

| ID | Question | Decision | Effect on documents |
|---|---|---|---|
| D-01 | Customer login identifier (open item from TASK-002) | **Email + password.** | Customers log in with email + password. Phone remains required, normalized and unique per customer because it is still the primary business identifier (Q41) for COD confirmation and guest-order linking. |
| D-02 | Languages | **Arabic + English.** Arabic is right-to-left. | Website/app/dashboard are bilingual. Customer-facing catalog text (product/variant/brand/category names, descriptions, SEO fields) is stored in both languages. API supports a request locale. Notification templates exist per language. |
| D-03 | Same email for a customer and an employee | **Allowed.** | `accounts.email` is unique per `account_type`, not globally. Customer and employee logins stay fully separate (separate sessions, separate endpoints). |
| D-04 | Guest order tracking/cancellation | **No online tracking for guests.** | Guests cannot view, track or cancel orders online; they contact support, or create an account and link orders through the OTP claim flow (Q43/Q44). The WhatsApp COD confirmation link (R10) still works for guests but only confirms the order; it does not expose tracking or cancellation. The confirm-only link was confirmed by the owner during review. |
| D-05 | Default roles & permission catalog | **Approved as proposed** (delegated by owner to the recommended option). | `docs/security/permission-catalog.md` approved v1.0; Business Spec R17. |
| D-06 | Can Managers publish products / approve or complete returns / refund? | **No by default** (delegated, recommended option). | Business Spec R18; Owner/Admin may grant explicitly. |
| D-07 | Q76: which order transitions need Owner/Admin approval? | **None in v1** (delegated, recommended option). | Business Spec R19; approval requests used for purchases, over-delivery, campaigns, critical settings. |

## Scope

### 1. Cross-document hygiene
- [x] Keep C1–C6 and the Audit Corrections in `business-spec.md` only; replace the copies in `user-flows.md`, `system-architecture.md`, `database-design.md`, `api-contract.md` with a short reference.
- [x] Fix section numbering in `user-flows.md` (§11 contains 10.x; duplicate §8.2).
- [x] Align Shipment status lists (R2 includes `Delivered`, Audit Correction 1 omits it).
- [x] Roadmap §7 "Next Immediate Task" is stale; update. Update TASK-005 remaining scope (money + time only). Add TASK-002A to the roadmap and a sequencing note moving TASK-004 after TASK-012.
- [x] TASK-001 status checklist inconsistency.
- [x] Add `.gitattributes` (consistent line endings) — *repository hygiene file, not code.*

### 2. Business spec / user flows
- [x] Record D-01…D-07 as closure decisions R13–R19. (Ledger rows added.)
- [ ] Main-image rule: flows §4.1 ("every product") vs Q178 ("published product") — `[BUSINESS DECISION REQUIRED]` unless owner confirms Q178 wording.

### 3. Security / permissions
- [x] Publish one canonical permission catalog and default roles: `docs/security/permission-catalog.md` (**draft, awaiting owner approval**).
- [ ] Replace unnamed permissions in the API contract ("Refund permission", "Employee management", "Authorized scope", "Owner/Admin approval") with catalog codes.
- [ ] Resolve duplicates (`VIEW_PROFIT` vs `ANALYTICS_VIEW_PROFIT`).

### 4. Database design (audit DB-1 … DB-14)
- [x] DB-1 Add auth entities: `auth_sessions`, `otp_challenges`, `employee_invitations` (password reset reuses `otp_challenges`).
- [x] DB-2 Generic `idempotency_keys` (checkout keeps `checkout_attempts` or is folded in).
- [x] DB-3 `outbox_events` for reliable after-commit jobs (queue technology still deferred).
- [x] DB-4 Remove product-level `sku`/price/cost/threshold (C6: variant level). Low-stock threshold level → open decision.
- [x] DB-5 One consent model (`marketing_consents` history + current state) including guest consent capture decision.
- [x] DB-6 Notifications for guests (transactional deliveries not tied to a customer) and staff notifications (low stock).
- [x] DB-7 `customer_contact_tasks` (Q19/Q129).
- [x] DB-8 `cod_confirmation_tokens` (secure WhatsApp link, confirm-only per D-04).
- [x] DB-10 Complete `orders` financial fields (`cod_amount`, applied discount, shipping rule snapshot, tax fields, captured wallet amount).
- [x] DB-12 `accounts` uniqueness per D-03; customer login per D-01.
- [x] DB-13 Campaign `FAILED` status; remove duplicate `discounts.active`; single main-image representation.
- [x] Bilingual catalog fields per D-02.
- [x] DB-14 Order-number format, anonymization fields (Q154) — technical proposals, marked for review.

### 5. API contract (audit API-1 … API-11)
- [x] API-1 Add error codes for unauthenticated/expired session and general rate limiting; state 401 vs 403 semantics.
- [x] API-3 Variant endpoints; admin category/brand CRUD; unpublish/disable.
- [x] API-4 Remove `/admin/inventory/{variantId}/receive` (stock enters only through goods receipts).
- [x] API-5 Manual shipment status endpoints; customer-contact task endpoints.
- [x] API-6 Return resolution endpoint (R7 choice), refund/complete overlap, customer return cancel.
- [x] API-7 Guest cart identification and merge on login; remove guest tracking per D-04; revised-order confirmation endpoint.
- [x] API-8 Employee auth: forgot/reset password, accept invitation, resend OTP, logout-all. Customer deactivate/anonymize.
- [x] API-9 Admin customers list/detail; purchase send/cancel; over-delivery approval; supplier return approve/settle; low-stock alerts.
- [x] API-10 One upload flow. API-11 One preferences/consent endpoint set.
- [x] Locale handling (`Accept-Language` / `locale` parameter) per D-02.

### 6. Architecture
- [x] Record i18n/RTL (D-02) and outbox pattern; list remaining deferred vendor choices.

### Resolution notes (v1.2)
- Decision-dependent items are written into the documents as `[BUSINESS DECISION REQUIRED]` (see the list below), not resolved.
- Code follow-ups (not part of this task): add `UNAUTHENTICATED` / `RATE_LIMITED` to `app-error.ts` and redact secrets inside logged error messages — recorded under TASK-005.
- Ledger worksheet "Closure & Audit Decisions": rows R13–R19 added.

### 7. Promote status
- [x] After owner review: mark Architecture, Database Design, API Contract as **Approved v1.2**. (Review checklists are verified by the tests of each implementing task.)

## Remaining open decisions (not blocking this task's start)
Recorded as `[BUSINESS DECISION REQUIRED]` in the owning documents until answered:
1. Employee OTP: mandatory for all employees? Owner/Admin MFA: same email OTP or separate factor? Default staff session length.
2. Sessions after password reset (revoke all?).
3. Channel for phone-change OTP and guest-order claim OTP.
4. Hosting model (long-running server vs serverless) — technical, owner confirms.
5. Low-stock threshold per product or per variant.
6. When stock/wallet reservations are consumed/captured; whether reservations create inventory movements.
7. Governorate/area as a managed list vs free text.
8. Tax rate(s); EGP only.
9. COD cash collection/reconciliation with carriers: in v1 or not.
10. Return pickup fee when responsibility changes after inspection.
11. Guest marketing consent at checkout: allowed or accounts only.
12. Confirm ledger "Recommended" rows Q141, Q149, Q150, Q182, Q183.

## Acceptance Criteria
- Every CONTRA item from the audit is resolved or explicitly marked `[BUSINESS DECISION REQUIRED]`.
- Every owner decision above appears in `business-spec.md` and the affected documents.
- One canonical permission catalog exists and the API contract uses only its codes.
- DB design contains every entity required by ADR-0008 and API §9.
- No application code changed.

## Tests
Not applicable (documentation). Validate by owner review and a consistency grep for permission codes and status values.

## Definition of Done
- Owner review completed; DB design and API contract promoted to Approved v1.2.
- One focused commit on `feature/TASK-002A-docs-closure`, merged through a PR.

## Status
- [x] Planned
- [x] In Progress
- [x] Reviewed
- [ ] Done
