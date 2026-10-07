# ADR-0045 — Dashboard shell: API client, session handling, navigation

**Status:** Accepted (TASK-052, 2026-10-07)

## Context
TASK-052 builds the staff dashboard shell: sign-in, session handling, permission-aware navigation and error states. The architecture keeps the Website, Dashboard and Mobile App as clients of one backend API (Architecture §1, §3), and the backend is authoritative for permissions (Security §5). The invitation email already links to `<DASHBOARD_URL>/staff/accept-invitation#token=…` (ADR-0016). There is no Stitch reference for dashboard screens.

## Decision
1. **Location.** The dashboard lives in the existing Next.js app under `/staff` (`src/app/staff/**`): `(auth)` pages (login, forgot-password, accept-invitation) without the shell, `(shell)` pages inside it. No monorepo move.
2. **Client of the API.** Dashboard screens call `/api/v1/**` over HTTP with the employee cookie transport (ADR-0013/0015) through `src/app/staff/_lib/api.ts`. They never import `src/server/**` business code (one type-only import of the permission codes), so the dashboard holds no business logic and every action is authorized by the API.
3. **Session handling.** Tokens stay in HttpOnly cookies. On `401 UNAUTHENTICATED` the client calls `POST /employee-auth/refresh` once (shared by concurrent calls) and retries; if that fails the employee is sent to `/staff/login?reason=expired&next=…`. The shell loads `GET /employee-auth/session` once per page load (no polling, so the idle limit of R29 is not extended by an open tab) and sends the employee to sign-in when `session.expiresAt` (12-hour maximum) passes. Sign-out calls `logout` or `logout-all`. `next` accepts only `/staff…` paths (no open redirect).
4. **Navigation.** `src/app/staff/_lib/navigation.ts` lists the sections and the catalog permissions of their read endpoints; a section is shown when any one is held. This is cosmetic; a direct visit to a section the employee may not open shows an access-denied state and the API still refuses the data. Sections without a screen yet render a placeholder at `/staff/[section]`; TASK-053..057 replace them with real routes.
5. **Languages (R14).** Arabic and English with a small dictionary (`_lib/i18n.tsx`, cookie parsing in `_lib/lang.ts` for the server layout); Arabic renders right-to-left. The choice is kept in the `bf_staff_lang` cookie (`Path=/staff`) so the server renders the right `dir` on first paint. Default: Arabic (open item for the product owner).
6. **Look.** Colors and the display font follow the Stitch "Editorial Velvet" design system and the account-page sidebar pattern; brand tokens are added to `globals.css`. No new dependencies.

## Consequences
- Dashboard pages are client-rendered behind a short loading state; this is acceptable for an internal, non-indexed (`noindex`) tool.
- Feature screens reuse `staffApi`, `useStaffSession`, `StatusPanel` and `errorMessage` and handle `PERMISSION_DENIED` from the API themselves.
