# ADR-0071 — End-to-End Regression Suite (Playwright)

- **Status:** Accepted (TASK-063)
- **Date:** 2026-10-17
- **Relates to:** ADR-0009 (Vitest), ADR-0010 (integration database), ADR-0012 (CI), ADR-0014 (local mailbox), ADR-0017 (seeds); Test Strategy §3 "End-to-end"

## Context

Test Strategy §3 asks for automated end-to-end tests of the high-value customer/admin flows, browse → checkout → delivery → return → refund. Vitest (ADR-0009) cannot drive a browser. The flows cross the storefront, the staff dashboard, email codes (customer verification, staff login R28) and the API.

## Decision

1. **Tool: Playwright** (`@playwright/test`, exact version, devDependency only), Chromium only. It drives a real browser, waits on the accessibility tree (labels and roles, no test ids needed), starts the app as its `webServer`, and records traces on failure. No other new dependency.
2. **Layout:** `e2e/*.spec.ts` and `playwright.config.ts` at the repository root. Vitest only includes `src/**/*.test.ts`, so it never picks up the specs.
3. **Server:** the production build (`node server.mjs`, so the custom server and CSRF/IP rules run as deployed) on port `E2E_PORT` (default 3163), never reusing an existing server.
4. **Data:** a dedicated database (`E2E_DATABASE_URL`, default `beautyfits_e2e_test`; refused unless the name ends in `_test`) dropped, recreated from migrations and seeded on every run by `e2e/setup-db.ts` with the existing seeds — bootstrap Owner (test credentials in `e2e/config.ts`), the sample catalog and the sample delivery areas — plus one carrier through the shipping service. Mail, WhatsApp and media go to throwaway folders under the OS temp directory. No external service is called (none exists yet: email and WhatsApp are local files).
5. **Codes:** the specs read customer and staff email codes from the `.eml` files in the E2E mailbox (base64 body).
6. **Scope:** UI first. The return assessment (TASK-040) has no screen, so that one step is an API call from the signed-in staff session; read-backs (order/return status, wallet balance) use the API too.
7. **Serial:** one worker. The lifecycle spec is a `serial` describe because each step builds on the order/return of the previous one.
8. **CI:** a separate `e2e` job in `.github/workflows/ci.yml` (PostgreSQL 17 service, `playwright install --with-deps chromium`, build, `npm run test:e2e`). It is separate from `verify` so the required check is unchanged; the owner decided to require it (2026-10-18, BD-073) and enables it in GitHub branch protection.

## Consequences

- `npm run test:e2e` needs Docker PostgreSQL, a fresh `npm run build` and, once per machine, `npx playwright install chromium`.
- UI copy changes on the covered screens can break the specs (they select by English labels); update them together.
- The suite adds a few minutes to CI (build + about one minute of tests).
