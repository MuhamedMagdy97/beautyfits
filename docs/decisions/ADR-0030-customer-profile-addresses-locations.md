# ADR-0030 — Customer Profile, Addresses and Locations

- **Status:** Accepted (TASK-009); the defaults in §3 await product-owner confirmation
- **Date:** 2026-10-04
- **Relates to:** ADR-0013 (customer sessions, throttling), ADR-0014 (email OTP), ADR-0018 (audit); Business Spec Q45, Q46, Q122, Q152, Q153, R24, R27, R30, R32; User Flows §3.3, §3.4; DB Design §3.2, §3.3, §15 and "v1.2 TASK-009 Amendments"; API Contract §11 and "TASK-009 Amendments"

## 1. Locations (R32)

- Tables `governorates` and `areas`. The migration preloads the 27 Egyptian governorates (ISO 3166-2:EG code, Arabic and English names). Areas start empty: the Owner/Admin adds them (`SHIPPING_MANAGE`) before customers can save addresses.
- Neither is ever deleted (trigger); each has `status` `ACTIVE`/`INACTIVE`. An area name is unique within its governorate, per language.
- `GET /locations` (public) lists active governorates with their active areas in the request language. `GET /admin/locations` (`SHIPPING_VIEW`) lists everything in both languages. `PATCH /admin/governorates/{id}`, `POST /admin/governorates/{id}/areas` and `PATCH /admin/areas/{id}` (`SHIPPING_MANAGE`) write audit entries.
- TASK-027 points `shipping_rules` at the same tables.

## 2. Profile, email and phone

- `GET/PATCH /me`: full name, preferred language, optional date of birth. Changing them is not audited (no business impact); email and phone changes are.
- **Email change (Q152):** `POST /me/change-email { currentPassword, newEmail }` checks the password, then sends a code to the new email (`EMAIL_CHANGE` challenge, destination = new email). `POST /me/change-email/verify { code }` switches the email (verified at once) and notifies the previous address.
- **Phone change (Q153 as amended by R30):** `POST /me/change-phone { currentPassword, newPhone }` checks the password, then sends a code to the account's verified email (`PHONE_CHANGE` challenge; the new phone is kept in `otp_challenges.pending_value`). `POST /me/change-phone/verify { code }` switches the phone and notifies the email.
- Re-authentication is the current password. Wrong passwords count toward the R24 account lock, as for password change. Code limits are those of ADR-0014 (60 s cooldown, 5 per hour per purpose and email, 5 attempts, 5 minutes, 20 sends per IP per hour).
- A verified email or phone of another customer account is refused (`409 CONFLICT`) both when the code is requested and when it is verified (the partial unique indexes catch a race).

## 3. Defaults (to confirm with the product owner)

1. A customer can save at most **20 addresses**.
2. The first address becomes the default. Deleting the default makes the most recently updated remaining address the default.
3. Required address fields: recipient name, recipient phone (Egyptian mobile, R27), area, street. Optional: label, city, building, floor, apartment, landmark, notes.
4. Addresses are deleted for real: orders keep their own address snapshot (Q46), so nothing references them.
5. Email and phone changes keep the customer's sessions.
6. Date of birth is optional, cannot be in the future or before 1900.

## Consequences

- Migration `customer_profile_addresses`: `location_status` enum, `governorates` (seeded), `areas`, `customer_addresses`, `customers.date_of_birth`, `otp_challenges.pending_value`.
- `GET /me`, login and session responses gain `customer.dateOfBirth`.
- `/me/deactivate` (Q154) waits for owner answers (task file, Open Items). `/me/notifications` and `/me/preferences` belong to TASK-045, marketing consent to the marketing tasks.
- No new dependency.
