# TASK-067 — Mobile API Readiness Review

## Goal
Verify that the API contract and the implemented `/api/v1` routes can serve the future mobile app as they are, without duplicating business logic or adding mobile-only rules (roadmap Phase 13; Architecture principles 1 and 9). Fix small real gaps with tests. Record open owner decisions.

## Dependencies
TASK-060 (customer account screens), TASK-063 (E2E regression suite).

## Source of Truth
- `docs/architecture/system-architecture.md` §2 (principles 1, 9), §5 "Mobile App", R14 row
- `docs/api/api-contract.md` §4–§9, §28, §29, §33, "TASK-007 Amendments"
- ADR-0004 (API foundation), ADR-0013 (customer sessions, transports, CSRF), ADR-0021 (uploads), ADR-0031 (cart), ADR-0035 (checkout), ADR-0043 (notifications), ADR-0055 (website i18n), ADR-0069 (no CORS)
- Business Spec Q57, Q58, Q61, R14, R23

## Scope
- Review every customer-facing route (everything under `src/app/api/v1/**` except `admin/**` and `employee-auth/**`, which the dashboard alone uses).
- Check: bearer-token auth, refresh/session flows, pagination and error-code consistency, idempotency, the upload flow from a native client, web-only assumptions (Origin checks, redirects, HTML responses, cookies), localization (ar/en), push notification readiness.

## Non-Goals
- Building the mobile app, or any mobile-only endpoint.
- Push notification delivery (needs an owner decision, see Open Items).
- App/universal-link setup on the website domain (goes with deployment, TASK-066, and the mobile app).

## Files / Modules
- `docs/tasks/TASK-067-mobile-api-readiness.md` (this file)
- `docs/api/api-contract.md`: "TASK-067 Amendments (mobile clients)" — clarifies existing behaviour only
- `docs/decisions/open-business-decisions.md`: BD-086 (push notifications)
- `docs/tasks/implementation-roadmap.md`: status after TASK-067

## Business Rules
No new business rules. The mobile app uses the same endpoints, validation and error codes as the website.

## API Changes
None to behaviour. The contract gains a "TASK-067 Amendments" section that writes down, for native clients, what the code already does (transport, refresh, relative URLs, error message language, deep links).

## Database Changes
None. No migration.

## Readiness Checklist

Status: ✅ ready · ⚠️ open (see Open Items) · ℹ️ client guidance (no backend change needed)

| # | Item | Source | Status | Evidence |
|---|---|---|---|---|
| 1 | Customer auth works with `Authorization: Bearer`; bearer is the default transport, cookies only on `X-Auth-Transport: cookie` | API §5, ADR-0013 | ✅ | `src/server/modules/auth/transport.ts:54,79`; `src/server/modules/auth/http.ts:39`; test `src/app/api/v1/auth/auth-routes.int.test.ts:247` |
| 2 | Every customer guard reads the bearer token first; no customer route reads cookies itself | Arch principle 9 | ✅ | `src/server/modules/auth/guard.ts:25-41`; `src/server/modules/cart/http.ts:20` (only cookie users are `auth/*` and `me/deactivate`, to clear website cookies) |
| 3 | Refresh: token in the JSON body, rotated pair returned in the body; 30-day absolute session, never extended (R23) | ADR-0013 | ✅ | `src/app/api/v1/auth/refresh/route.ts`; `src/server/modules/auth/transport.ts:93`; test `auth-routes.int.test.ts:255-262` |
| 4 | Concurrent refreshes with one token: one wins; the loser within 10 s gets `UNAUTHENTICATED` but the session survives | ADR-0013 | ℹ️ client must single-flight its refresh | `src/server/modules/auth/auth-service.ts:454`; `src/server/modules/auth/policy.ts:24` |
| 5 | Session read, logout and logout-all work for bearer clients (204, no cookies) | API §4, TASK-007 | ✅ | test `auth-routes.int.test.ts:252,264-267` |
| 6 | CSRF/Origin check never blocks a client that sends no Origin; strict only for cookie auth or cookie transport | ADR-0013 | ✅ | `src/server/modules/auth/transport.ts:134-152`; `src/server/modules/auth/guard.ts:31` |
| 7 | No CORS needed: a native app is not a browser | ADR-0069 | ✅ | `next.config.ts:5-8` |
| 8 | No redirects, HTML or middleware on `/api/v1`; unknown paths return the JSON error envelope | API §6.1 | ✅ | no `src/proxy.ts`/`middleware.ts`; `src/app/api/v1/[[...path]]/route.ts`; only binary responses are `files/uploads/[id]` (204) and `files/[id]/content` (image bytes) |
| 9 | Guest cart identified by the `X-Guest-Cart-Token` header, not a cookie; the token comes back in the body on the first write | API §14, ADR-0031 | ✅ ℹ️ app stores it securely | `src/server/modules/cart/http.ts:6-13`; test `src/app/api/v1/cart/cart-routes.int.test.ts:163` |
| 10 | Guest analytics identity by `X-Anonymous-Id` header | ADR-0044 | ✅ | `src/server/modules/analytics/http.ts:6` |
| 11 | Pagination: same `page`/`pageSize` parameters and `meta.pagination` shape on every customer list (orders, returns, wallet transactions, notifications, products, reviews) | API §6, §8 | ✅ | `src/server/modules/rbac/schemas.ts:59-63` (shared `pageQuery`, max 100); `src/server/modules/catalog/schemas.ts:378` (products, max 48); `src/server/http/response.ts:6-43` |
| 12 | Unpaginated customer lists are bounded | API §8 | ✅ | wishlist max 100 items `src/server/modules/wishlist/wishlist-service.ts:29`; addresses, brands, categories, locations are small fixed lists |
| 13 | One error envelope and stable codes; every handler is wrapped in `withApi` | API §6.1, §29 | ✅ | `src/server/http/route-handler.ts:24-67`; `src/app/api/v1/route-guards.test.ts` |
| 14 | Throttled endpoints all return `details.retryAfterSeconds` | API §6.1 | ✅ | e.g. `src/server/modules/checkout/checkout-service.ts:427`, `src/server/modules/auth/auth-service.ts:124`, `src/server/modules/media/uploads-service.ts:319` |
| 15 | Error `message` is English developer text in every locale; clients translate by `code` and `details.issues[].code` | ADR-0055 §5 | ℹ️ written into the contract | `src/server/http/validation.ts:93-103`; website does the same (ADR-0055) |
| 16 | `Idempotency-Key` required on checkout; a retry with the same key returns the same order, another body is `IDEMPOTENCY_CONFLICT` | API §9, ADR-0035 | ✅ | `src/app/api/v1/checkout/route.ts:17`; `src/server/http/validation.ts:90`; test `src/app/api/v1/checkout/checkout-routes.int.test.ts:232` |
| 17 | Other customer creates take no key (the contract asks keys only for checkout and money writes). A repeated review is refused (one per order item); a repeated wishlist add changes nothing. A retried **return request** for part of an item's quantity can create a second return; only units beyond what is still returnable are refused | API "Idempotency (completes §9)" | ⚠️ follow-up: optional `Idempotency-Key` on `POST /orders/{id}/returns` (contract change, not mobile-only — the website retries too) | `src/server/modules/returns/returns-service.ts:539` |
| 18 | Upload flow is plain HTTP: `POST /files/upload-init` (bearer) → `PUT` raw bytes to the returned `url` with the returned `headers` (single-use token, no session, no multipart, no Origin) → `POST /files/complete` | API §28, ADR-0021 | ✅ | `src/app/api/v1/files/upload-init/route.ts:19-38`; `src/app/api/v1/files/uploads/[id]/route.ts:12-30`; `src/server/modules/media/uploads-service.ts:357-358` |
| 19 | Upload and media URLs are relative (`/api/v1/files/...`) | API §28 | ℹ️ resolve against the API base URL | `src/server/modules/media/uploads-service.ts:202,357` |
| 20 | Accepted image types are JPEG, PNG, WebP (content-checked); iOS HEIC photos are refused | ADR-0021 | ℹ️ app converts camera photos to JPEG | `src/server/modules/media/image-inspection.ts:13` |
| 21 | Localized public responses pick `ar`/`en` from `Accept-Language` (default `ar`); account language is `preferredLocale`, editable with `PATCH /me` and used for notifications/emails | API §5, R14 | ✅ | `src/server/http/locale.ts:14`; `src/server/modules/customers/schemas.ts:27`; `src/server/modules/notifications/notifications-service.ts:294` |
| 22 | In-app notifications carry a structured deep link (`deepLink: {type, id}`), not a web URL, plus read/read-all | Q57, Q58 | ✅ | `src/server/modules/notifications/notifications-service.ts:68,100-101` |
| 23 | WhatsApp/email messages link to website URLs (COD confirm, product page) | ADR-0043 | ℹ️ the app can claim them later as app/universal links; the website pages keep working | `src/server/modules/notifications/templates.ts:167-174` |
| 24 | Push notifications (device registration, FCM/APNs channel) | Q55, Q56, Q61 | ⏸ deferred (owner 2026-10-18, no mobile app for now): channels are WhatsApp + email only | `prisma/schema.prisma:2373` (`NotificationChannel`); BD-086 |
| 25 | Unsupported method on an existing route (e.g. `DELETE /me`) answers Next.js's bare `405` without the envelope | API §6.1 | ℹ️ clients only call documented methods; same for the website | verified on `next start`: `DELETE /api/v1/me` → 405, empty body |
| 26 | Rate limits are per IP; many phones behind one carrier NAT share a counter | API §30 | ℹ️ watch after launch; thresholds are owner decisions | `src/server/modules/auth/policy.ts`; `src/server/http/client-ip.ts` |
| 27 | No mobile-only business rule exists or is needed | Arch principles 1, 9 | ✅ | this review: every item above uses the shared endpoints |

## Acceptance Criteria
- [x] Every customer-facing route reviewed against the checklist above.
- [x] No mobile-only endpoint or rule introduced.
- [x] Client guidance written into the API contract ("TASK-067 Amendments").
- [x] Open owner decisions recorded, not decided in code.

## Tests
No behaviour changed, so no new tests. The evidence column cites the existing tests that prove the mobile paths: bearer login/session/refresh/logout-all without Origin (`auth-routes.int.test.ts:247`), header-based guest cart (`cart-routes.int.test.ts:163`), checkout idempotency (`checkout-routes.int.test.ts:232`), route-guard audit (`route-guards.test.ts`).

## Edge Cases
- A mobile client that sends an `Origin` header (e.g. a web view or Expo web) must send an allowed one; native HTTP clients send none.
- Sending both a bearer token and `X-Guest-Cart-Token`: the signed-in cart wins, and `POST /cart/merge` folds the guest cart in (R33).
- A bad bearer token on the cart is `401`, never a silent fall back to the guest cart.

## Open Items
- Deferred (owner 2026-10-18): no mobile app for now — push notifications (BD-086); channels stay WhatsApp and email plus the in-app list.
- Follow-up task: accept an optional `Idempotency-Key` on `POST /orders/{orderId}/returns` (item 17), with a contract and test update. Not done here: it changes public API behaviour for both clients, so it gets its own task.
- Deferred (owner 2026-10-18): no mobile app for now — app/universal links for `WEBSITE_URL` paths (`/orders/{id}/confirm-cod`, `/products/{slug}`), with deployment (TASK-066).

## Definition of Done
Required checks green (lint, format, typecheck, unit, integration, build); docs updated; committed on `feature/TASK-067-mobile-api-readiness`.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
