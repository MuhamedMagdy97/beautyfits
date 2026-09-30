# ADR-0009 — Testing foundation (Vitest)

- **Status:** Accepted (TASK-002); extended by TASK-003 and TASK-006
- **Date:** 2026-09-30
- **Relates to:** Test Strategy §3, §4, §9

## Decision

- The **test runner is Vitest 4** (`vitest.config.mts`). It uses the Node environment and resolves the `@/` alias to `src/`. Tests are colocated as `src/**/*.test.ts`.
- Scripts:
  - `npm test` runs the suite once (CI and pre-commit use);
  - `npm run test:watch` runs in watch mode for local development;
  - `npm run typecheck` runs `next typegen && tsc --noEmit`. It generates the Next.js global route types (`LayoutProps`, `RouteContext`, …) first, so it works on a clean checkout where plain `tsc --noEmit` fails;
  - `npm run lint` runs ESLint.
- Why Vitest: native TypeScript/ESM without a Babel/Jest transform layer, fast, and documented by Next.js. It covers unit and integration tests with one runner. Jest would need extra transform configuration for ESM and the Prisma 7 generated client.
- **Scope in TASK-002** is foundation tests only: environment validation, error codes and status mapping, response envelopes, request ids, validation helpers, the route wrapper's error mapping, logger redaction, health logic, and the `/api/v1` fallback route. No business tests.
- **Deferred:**
  - PostgreSQL integration tests: done in TASK-003 (ADR-0010), run in CI since TASK-006 (ADR-0012);
  - CI workflow and formatter: done in TASK-006 (ADR-0012). Coverage thresholds remain open;
  - component/UI tests (jsdom + Testing Library) when UI work starts, and E2E tests (TASK-063).
