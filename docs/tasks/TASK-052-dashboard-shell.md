# TASK-052 — Dashboard Shell & Permission-aware Navigation

## Goal
Staff open the dashboard at `/staff`, sign in with password and email code, see only the sections their roles allow, stay signed in while the session is valid and are sent back to sign-in when it ends. Invited staff accept their invitation, and staff can reset a forgotten password, from dashboard pages.

## Dependencies
TASK-011 (employee auth), TASK-012 (roles, permissions, invitations, session permissions). Followed by TASK-053..057 (feature screens).

## Source of Truth
- Business Spec R14, R15, R28, R29, Q64
- Architecture §1, §3, "Admin Dashboard"
- API Contract "TASK-011 Amendments", "TASK-012 Amendments"
- `docs/security/permission-catalog.md`, Security Requirements §4, §5
- Design reference: `design-reference/google-stitch/editorial_velvet` and the account page sidebar (`beautyfits_account_orders_wallet`); there is no dashboard screen in Stitch.
- ADR-0013, ADR-0015, ADR-0016; ADR-0045 (this task)

## Scope
- `/staff/login` (password, then email code with resend; trusted device skips the code), `/staff/forgot-password`, `/staff/accept-invitation` (token from the URL fragment).
- Shell for `/staff/**`: header (name, level, language switch, sign out, sign out everywhere), sidebar navigation filtered by the session permissions, overview page.
- Session handling: cookie transport, one refresh on expired access token, redirect to sign-in when the session ends (and at the 12-hour maximum), safe `next` redirect.
- States: loading, error with retry, access denied, section not yet available, 404, error boundary.
- Arabic (RTL) and English for the shell (R14).

## Non-Goals
- Feature screens (products, orders, purchasing, wallet, marketing, settings, roles, approvals, audit): TASK-053..057.
- Any API, database or permission change.
- Client-side idle-timeout warning: the API enforces the 60-minute idle limit (R29) on the next request.

## Files / Modules
- `src/app/staff/layout.tsx`, `error.tsx`, `not-found.tsx`
- `src/app/staff/(auth)/login/{page,login-form}.tsx`, `(auth)/forgot-password/page.tsx`, `(auth)/accept-invitation/page.tsx`
- `src/app/staff/(shell)/layout.tsx`, `(shell)/page.tsx`, `(shell)/[section]/page.tsx`
- `src/app/staff/_lib/{api.ts,session.tsx,navigation.ts,i18n.tsx,lang.ts}`, `_components/ui.tsx`
- `src/app/globals.css` (brand color tokens)

## Business Rules
R28/R29 as implemented by the API; R14 languages. No new rules.

## API Changes
None. The dashboard uses the existing employee-auth endpoints.

## Database Changes
None.

## Security / Authorization
- Navigation hiding is cosmetic; every request is authorized by the API.
- Tokens only in HttpOnly cookies set by the API; the page never reads them. State-changing calls are same-origin (CSRF `Origin` check of ADR-0013).
- The invitation token is read from the fragment and removed from the address bar after use.
- The post-login `next` parameter only accepts `/staff` paths.
- Error boundary shows no error details. Pages are `noindex`.

## Acceptance Criteria
- Sign-in works with a code on a new device and without it on a trusted device; wrong password, wrong/expired code and rate limits show localized messages.
- The sidebar shows only sections the employee's permissions allow; Owner/Admin see all; an employee without roles sees an empty overview message.
- Visiting a section without permission shows access denied; an unknown section shows 404.
- An expired access token is refreshed transparently; an ended session sends the employee to sign-in with a notice and returns them afterwards.
- Sign out and sign out everywhere end the session(s).
- The shell renders right-to-left in Arabic and left-to-right in English.
- All required checks pass.

## Tests
- Unit `src/app/staff/_lib/navigation.test.ts`: catalog codes only, visibility per permission, empty groups dropped, `safeNextPath` rejects external and non-dashboard paths.
- Unit `src/app/staff/_lib/api.test.ts`: cookie transport, single shared refresh and retry, refused refresh, no refresh on other errors, network failure.
- The flows themselves are covered by the existing employee-auth and RBAC route integration tests.

## Edge Cases
- Two requests expire at once: one refresh, both retried.
- Session maximum reached with the page open: redirect at `expiresAt`.
- Deactivated employee (`403 FORBIDDEN` on session): error state, not a redirect loop.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] Default dashboard language for a first visit: Arabic is used (R14 lists Arabic first, staff emails are Arabic first); the product owner should confirm.
- The navigation grouping and section names are a UX proposal; the product owner may rename or regroup them (no business rule depends on them).
- No Stitch design exists for the dashboard; the shell follows the Editorial Velvet design system. A dashboard reference from design would replace this proposal.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
