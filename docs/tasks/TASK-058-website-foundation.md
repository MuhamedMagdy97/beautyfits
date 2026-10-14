# TASK-058 — Existing Website API Integration Foundation

## Goal
The customer website at the site root talks to the backend API: a storefront shell (header, footer, language switch), a customer API client, customer sign-in/registration/recovery with session handling, the guest cart token with the merge after sign-in, and loading/error/404 states, in Arabic (RTL) and English. Catalog, cart and checkout screens build on it in TASK-059.

## Dependencies
TASK-007/008 (customer auth, email codes), TASK-025 (cart, guest token, merge), TASK-029/030 (checkout, orders, used by TASK-059). Mirrors TASK-052 (dashboard shell). Followed by TASK-059, TASK-060.

## Source of Truth
- Business Spec R14, R16, R23–R27, R33, R35
- User Flows §3.1, §3.2, §6.1
- Architecture §1, §3, "Customer Website"
- API Contract §4, §5, "TASK-007 Amendments", "TASK-008 Amendments", "TASK-025 Amendments"
- Security Requirements (cookie transport, CSRF `Origin` check), ADR-0013, ADR-0014, ADR-0031, ADR-0045
- Design reference: `design-reference/google-stitch/beautyfits_luxury_beauty_homepage` (header, footer), `beautyfits_brand_logo`, `editorial_velvet`
- ADR-0055 (this task)

## Scope
- Storefront route group `src/app/(store)`: layout with header (brand, language switch, sign-in / customer menu with sign out and sign out of all devices, bag with item count) and footer; home placeholder; error boundary; root 404.
- Customer API client: cookie transport, `Accept-Language`, one shared refresh and retry, guest cart token header and capture, typed errors.
- Shopper session: guest or customer, loaded once per page; guest cart merge after sign-in; `redirectToLogin` and a safe `next`.
- Pages `/login` (unverified email switches to the code step), `/register` (account data → email code → signed in), `/forgot-password` (email → code → new password).
- Arabic (default, RTL) and English via the `bf_lang` cookie; `<html lang dir>` set by the root layout.

## Non-Goals
- Catalog, search, product detail, cart, checkout, account, addresses, wishlist, reviews screens (TASK-059); order tracking, returns, wallet (TASK-060).
- Category navigation and search box of the Stitch header (need the public catalog endpoints, see Open Items).
- Analytics `X-Anonymous-Id` (sent by the screens that record events, TASK-059).
- Any API, database or permission change.

## Files / Modules
- `src/app/layout.tsx` (metadata, `lang`/`dir`), `src/app/not-found.tsx`; `src/app/page.tsx` removed
- `src/app/(store)/layout.tsx`, `page.tsx`, `error.tsx`, `login/{page,login-form}.tsx`, `register/{page,register-form}.tsx`, `forgot-password/page.tsx`
- `src/app/(store)/_lib/{api.ts,api.test.ts,session.tsx,i18n.tsx,lang.ts}`, `_components/{shell,auth,not-found-panel}.tsx`
- `src/app/_components/ui.tsx` (generic pieces moved from `src/app/staff/_components/ui.tsx`, which re-exports them)

## Business Rules
R14, R23–R27, R33, R35 as implemented by the API. No new rules; the website validates nothing the API does not.

## API Changes
None. The website uses existing endpoints.

## Database Changes
None.

## Security / Authorization
- Tokens only in HttpOnly cookies set by the API; page code never reads them. Same-origin requests carry `Origin` for the CSRF check.
- The post-login `next` accepts only storefront paths (no open redirect, no `/staff` or `/api`).
- The guest cart token in `localStorage` grants access to a guest cart only (ADR-0055).
- Error boundary shows no error details; API validation messages are not shown verbatim. Sign-in pages are `noindex`.

## Acceptance Criteria
- The storefront renders at `/` in Arabic (RTL) by default and in English (LTR) after switching; `/staff` is unchanged.
- A guest sees "Sign in"; a signed-in customer sees the name menu with sign out and sign out of all devices.
- Sign-in, registration with email code and password recovery work against the API and show localized errors (wrong password, unverified email, wrong/expired code, rate limits, duplicate account, password policy, invalid phone).
- An expired access token is refreshed once and the request retried; an ended session behaves as a guest.
- A guest cart token returned by the API is kept and sent; after sign-in the guest cart is merged and the token dropped.
- Unknown URLs show the localized 404; render errors show the retry boundary.
- All required checks pass.

## Tests
- Unit `src/app/(store)/_lib/api.test.ts`: cookie transport and language header, guest token capture and header, blocked storage, single shared refresh and retry, refused refresh, no refresh on other errors, network failure, `safeNextPath`.
- The flows are covered by the existing customer auth and cart route integration tests; the pages were checked in the browser (dev server).

## Edge Cases
- Two requests expire at once: one refresh, both retried.
- Expired guest cart (R35): the old token is unknown, the next write returns a new one.
- Merge fails (network): token kept, retried on the next page load (merge is idempotent).
- Recovery: a new password refused by the policy can be retried without a new code (the reset token is kept).
- Session revoked on another device: up to 15 minutes of `401` on cart calls (ADR-0055 consequence).

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] Default website language for a first visit: Arabic is used (API default `ar`, R14 lists Arabic first; same open item as the dashboard in TASK-052). Alternative: follow the browser language.
- [BUSINESS DECISION REQUIRED] Header announcement bar: the Stitch design shows "Free shipping on orders over 2,500 EGP • Cash on Delivery across Egypt". The free-shipping threshold comes from the shipping rules (TASK-027) and is not hard-coded; the product owner decides whether the bar is shown and where its text comes from. Not built.
- Public catalog endpoints `GET /products`, `/categories`, `/brands` (API §13) are not implemented yet; TASK-059 needs them (category navigation, search, product screens).
- The tagline "Beauty that fits you" comes from the Stitch brand logo; the Arabic wording is a proposal for the product owner.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
