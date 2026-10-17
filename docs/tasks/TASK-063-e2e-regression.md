# TASK-063 — End-to-End Regression Suite

## Goal
Automate the high-value customer/admin flows from browse to checkout, delivery, return and refund (Roadmap TASK-063, Test Strategy §3).

## Dependencies
Website (TASK-058/059) and dashboard (TASK-052..057) integration; returns and refunds (TASK-037..041).

## Source of Truth
- `docs/testing/test-strategy.md` §3, §9
- `docs/product/user-flows.md` §6.2 (COD checkout), §8 (shipping), §11 (returns), §12.1 (wallet refund)
- `docs/api/api-contract.md` (auth, checkout, orders, shipments, returns, wallet)
- ADR-0014 (local mailbox), ADR-0017 (seeds), ADR-0066 / ADR-0068 (refund rules and completion)

## Scope
- Playwright suite (ADR-0071): `playwright.config.ts`, `e2e/`.
- Global setup: dedicated `beautyfits_e2e_test` database recreated from migrations and seeded with the existing seeds plus one carrier.
- Flows:
  1. Guest: shop search → product → add to bag → bag → COD checkout → confirmation (`e2e/guest-checkout.spec.ts`).
  2. Customer lifecycle (`e2e/order-lifecycle.spec.ts`, serial): registration with the emailed code → checkout → sign-in in a fresh browser → order list and detail → staff sign-in with the emailed code → record phone confirmation, confirm, prepare, ready, assign carrier, hand over, out for delivery, delivered → customer return request → staff approve, request pickup, receive, start inspection, inspect (restock) → assessment (BeautyFits responsible) → complete → wallet credited with the full order total.
- npm script `test:e2e`; CI job `e2e`.

## Non-Goals
- No app code changes (none were needed for testability).
- Cross-browser runs, visual regression, Arabic UI coverage.
- Concurrency scenarios (TASK-062).

## Files / Modules
`playwright.config.ts`, `e2e/config.ts`, `e2e/setup-db.ts`, `e2e/global-setup.ts`, `e2e/helpers.ts`, `e2e/*.spec.ts`, `package.json`, `.github/workflows/ci.yml`, `.gitignore`, `.prettierignore`, ADR-0071.

## Business Rules
None added. The suite asserts documented behavior only: COD orders start awaiting confirmation (R10), phone confirmation is followed by the System transition (R1), a BeautyFits-responsible fully restocked return refunds the products and the delivery fee to the wallet (ADR-0066, ADR-0068).

## API Changes
None.

## Database Changes
None (no migration).

## Security / Authorization
Test-only credentials in `e2e/config.ts` exist only in the throwaway E2E database. The suite refuses to reset a database whose name does not end in `_test`. Real CSRF origin checks stay on (`AUTH_ALLOWED_ORIGINS` = the E2E origin).

## Acceptance Criteria
- [x] `npm run test:e2e` runs both specs against a fresh seeded database.
- [x] Flows listed in Scope pass.
- [x] Vitest does not pick up the E2E specs.
- [x] CI runs the suite in a separate job.

## Tests
- 8 Playwright tests (1 guest checkout, 7 lifecycle steps), passing on consecutive local runs.

## Edge Cases
- The product list is paginated: specs find products through the shop search.
- Email codes are matched by recipient and send time, so earlier emails do not interfere.

## How to run
```bash
docker compose up -d
npx playwright install chromium   # once per machine
npm run build
npm run test:e2e
```
Optional: `E2E_PORT` (default 3163), `E2E_DATABASE_URL` (default `beautyfits_e2e_test` on the docker-compose server). Failure traces: `test-results/e2e/` (`npx playwright show-trace <trace.zip>`).

## Open Items
- Whether the CI `e2e` job becomes a required check in branch protection (owner).
- The return assessment step uses the API until a screen exists (TASK-040 open item).

## Definition of Done
Required checks green, suite passing twice in a row, documentation updated.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
