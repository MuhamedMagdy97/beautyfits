# TASK-009 — Customer Profile & Addresses

## Goal
A signed-in customer can see and edit their profile, change their email or phone safely, and keep several delivery addresses with one default. Addresses use a managed governorate/area list that the Owner/Admin maintains and that shipping rules will reuse.

## Dependencies
TASK-007 (customer auth), TASK-008 (email OTP), TASK-013 (audit).

## Source of Truth
- Business Spec Q45 (multiple addresses + default), Q46 (orders keep a snapshot), Q122 (shipping by governorate/area), Q152 (email change), Q153 + R30 (phone change), R24 (lockout), R27 (Egyptian mobile), R32 (managed location list, owner decision 2026-10-04)
- User Flows §3.3, §3.4
- DB Design §3.2, §3.3, §15 (`shipping_rules` locations)
- API Contract §11
- Permission catalog (`SHIPPING_VIEW`, `SHIPPING_MANAGE`)
- ADR-0013, ADR-0014, ADR-0018

## Scope
- `governorates` (27 preloaded), `areas`, `customer_addresses`, `customers.date_of_birth`, `otp_challenges.pending_value`.
- `GET/PATCH /me`, `POST /me/change-email[/verify]`, `POST /me/change-phone[/verify]`, `/me/addresses` CRUD and `set-default`.
- `GET /locations`, `GET /admin/locations`, `PATCH /admin/governorates/{id}`, `POST /admin/governorates/{id}/areas`, `PATCH /admin/areas/{id}`.
- Audit actions `CUSTOMER_EMAIL_CHANGED`, `CUSTOMER_PHONE_CHANGED`, `GOVERNORATE_UPDATED`, `AREA_CREATED`, `AREA_UPDATED`.

## Non-Goals
- `/me/deactivate` (open decision below), `/me/notifications`, `/me/preferences` (TASK-045), marketing consent, guest order claim (TASK-010), shipping rules (TASK-027), dashboard and website UI.

## Files / Modules
- `prisma/schema.prisma`, `prisma/migrations/*_customer_profile_addresses/`
- `src/server/modules/customers/` (profile, addresses, emails, schemas), `src/server/modules/locations/`
- `src/server/modules/auth/` (`otp.ts` templates, `auth-service.ts` view and shared lockout key), `src/server/modules/audit/audit.ts`
- `src/app/api/v1/me/**`, `src/app/api/v1/locations/`, `src/app/api/v1/admin/{locations,governorates,areas}/**`
- `src/test/integration/database.ts` (governorates are reference data)
- Docs: Business Spec R32/R33, DB Design "v1.2 TASK-009 Amendments", API Contract "TASK-009 Amendments", ADR-0030

## Business Rules
- Q45/Q46: several addresses, at most one default; editing or deleting an address never touches an order (orders keep a snapshot).
- Q152: email change = current password + code to the new email; the previous email is notified.
- Q153/R30: phone change = current password + code to the verified account email; the email is notified. The new phone is not proven by a code.
- R27: phones are Egyptian mobiles in E.164.
- R32: addresses name an active area of an active governorate from the managed list.

## API Changes
API Contract "TASK-009 Amendments".

## Database Changes
Migration `customer_profile_addresses`. DB Design "v1.2 TASK-009 Amendments".

## Security / Authorization
Customer endpoints need an `ACTIVE` customer session (cookie requests pass the Origin check). Every address query is scoped to the signed-in customer; another customer's address id answers `404`. Email/phone changes need the current password (R24 lockout) and an email code (ADR-0014 limits). Location writes need `SHIPPING_MANAGE`, reads `SHIPPING_VIEW`. Inputs are validated with zod. Codes and passwords are never logged or audited.

## Acceptance Criteria
- Profile read and edit work; email and phone changes complete only with the right password and code, refuse identifiers verified by another account, and send the notice email.
- Addresses: create, list, edit, delete, set default; at most one default; first address default; limit 20; only active areas; scoped to the owner.
- Locations: 27 governorates present; areas can be added, renamed, deactivated; inactive ones disappear from `GET /locations` and cannot be chosen.
- All required checks pass.

## Tests
- Unit `src/server/modules/customers/schemas.test.ts`: address and profile validation.
- Integration `src/app/api/v1/me/me-routes.int.test.ts`: profile, email change, phone change, lockout, conflicts (including a race after the code was sent), addresses (default, ownership, inactive areas, limit) and locations (public and admin, permissions, audit).

## Edge Cases
- Wrong, expired or reused code; code requested for one email then verified after another account took it (`409`).
- New email/phone equal to the current one (`400`).
- Deleting the default address; deleting the last address.
- Area of an inactive governorate; area id of another governorate's area list on update.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] Account deactivation (Q154, `POST /me/deactivate`): anonymize at once or after a grace period? What happens with open orders, open returns or a wallet balance (refuse, or allow)? May the same email/phone register again afterwards? Which data is anonymized (name, email, phone, addresses, date of birth) and which is kept on orders?
- Record R32 and R33 (R33, the cart merge rule, was decided at the same time for TASK-025) in `docs/decisions/business-rules-ledger.xlsx`.
- Before launch, the Owner/Admin must add the areas of each served governorate: customers cannot save an address until its governorate has areas.

Technical defaults to confirm (ADR-0030 §3):
1. At most 20 addresses per customer.
2. The first address becomes the default; deleting the default makes the most recently updated remaining one the default.
3. Required address fields: recipient name, recipient phone (Egyptian mobile), area, street.
4. Addresses are deleted for real (orders keep snapshots).
5. Email and phone changes keep existing sessions.
6. Date of birth optional, not in the future, not before 1900.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
