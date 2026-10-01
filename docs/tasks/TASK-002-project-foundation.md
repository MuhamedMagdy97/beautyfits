# TASK-002 — Project Foundation (Backend Application Bootstrap)

## Goal
Establish the reusable technical foundation that later tasks build on: backend placement, ORM/migration strategy, auth architecture, validation, API/error conventions, logging, configuration, health checks, and test tooling. No business features.

## Dependencies
TASK-001.

## Source of Truth
- `AGENTS.md`
- `docs/product/business-spec.md` (Q41, Q42, Q151–Q165, R5, R8, R9)
- `docs/product/user-flows.md` §3
- `docs/architecture/system-architecture.md` §3, §4, §6, §25–§27
- `docs/database/database-design.md` §1, §3, §25
- `docs/api/api-contract.md` §2–§6, §10, §29, §30
- `docs/security/security-requirements.md`
- `docs/testing/test-strategy.md`
- `docs/tasks/implementation-roadmap.md` (TASK-002; foundation slices of TASK-003/005/006)

## Scope
- Backend placement and module boundaries (ADR-0001).
- Dependency review: remove unused or conflicting packages, align Prisma, add only what is required (ADR-0002).
- Prisma 7 + PostgreSQL adapter, lazy DB client, migration and seed strategy (ADR-0003). No tables.
- `/api/v1` foundation: `withApi` wrapper, request ids, contract envelopes, `AppError` with the §29 codes, default HTTP status mapping, NOT_FOUND fallback, and liveness/readiness endpoints (ADR-0004).
- zod validation helpers (ADR-0005).
- Structured JSON logger with sensitive-key redaction (ADR-0006).
- Validated, lazily loaded configuration; `.env.example`; `.gitignore` fix so `.env.example` can be committed (ADR-0007).
- Authentication architecture decision only (ADR-0008).
- Vitest, foundation tests, and the `typecheck`/`test`/`test:watch`/`postinstall` scripts (ADR-0009).
- `docker-compose.yml` for local PostgreSQL (development only).
- Documentation updates: README, architecture §3/§27, DB design §25, API contract §6.1 + TASK-002 amendments, security §12, test strategy §1/§9, AGENTS.md required checks, roadmap note.

## Non-Goals
- Any business domain: catalog, cart, checkout, orders, inventory, shipping, returns, wallet, reviews, wishlist, marketing, analytics.
- Auth implementation (TASK-007/008/011); RBAC (TASK-012); audit logs (TASK-013).
- Database tables, the first migration, the transaction helper, and migration scripts (TASK-003).
- Seeds (TASK-004).
- Money helpers and time handling (TASK-005).
- CI workflow, formatter, DB integration tests, and test DB reset (TASK-006).
- Rate limiting and idempotency middleware (owning feature tasks).
- Moving the app into `apps/web` or creating a monorepo.
- Changes to the existing starter UI.

## Files / Modules
- `package.json`, `package-lock.json`, `.gitignore`, `eslint.config.mjs`, `.env.example`, `docker-compose.yml`, `prisma.config.ts`, `prisma/schema.prisma`, `vitest.config.mts`, `README.md`
- `src/server/{config,db,errors,http,logging,health}/*`, `src/server/README.md`
- `src/app/api/v1/health/route.ts`, `src/app/api/v1/health/ready/route.ts`, `src/app/api/v1/[[...path]]/route.ts`
- Tests: `src/server/**/*.test.ts`, `src/app/api/v1/routes.test.ts`
- `docs/decisions/ADR-0001` … `ADR-0009`, `docs/decisions/README.md`

## Business Rules
None added or changed. Money-as-minor-units (R5/R9) is recorded as a schema convention only.

## API Changes
- Added operational endpoints `GET /api/v1/health` and `GET /api/v1/health/ready`.
- Documented error conventions: default HTTP status per error code, `details.issues` shape for `VALIDATION_ERROR`, `X-Request-Id` handling, and `Cache-Control: no-store` (API contract §6.1 and "TASK-002 Foundation Amendments").
- Unknown `/api/v1/*` paths return `404 NOT_FOUND` in the error envelope.

## Database Changes
None (no models or migrations). ORM, migration tool, and schema conventions are documented (DB design §25, ADR-0003).

## Security / Authorization
- No secrets committed. `.env*` stays ignored except `.env.example`, which holds local-only placeholders.
- Config errors name variables but never print their values.
- The logger redacts passwords, OTPs, tokens, cookies, authorization headers, secrets, hashes, and connection strings. Access logs omit query strings.
- Unexpected errors return a generic `INTERNAL_ERROR`; details are only logged server-side.
- Health endpoints expose no connection details.

## Acceptance Criteria
- [x] Backend starts locally with one command (`npm run dev` / `npm start`) and serves `/api/v1`.
- [x] `GET /api/v1/health` returns a stable `200 { data: { status: "ok" }, meta: { requestId } }`.
- [x] `GET /api/v1/health/ready` returns `503 not_ready` when the database is unreachable, verified against the production build. The `200 ready` path is covered by unit tests; a live-DB check was not possible in this environment (Docker daemon not running).
- [x] No business logic in the bootstrap layer.
- [x] API errors follow the contract envelope with stable codes.
- [x] Environment variables are validated and documented in `.env.example`.
- [x] Sensitive values are not logged (tested).
- [x] Dependencies match the decisions: no unused or conflicting packages, and Prisma CLI/client/adapter pinned to 7.10.0.
- [x] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass on a checkout without `.env`.
- [x] ADRs are recorded for every decision.

## Tests
Unit tests (Vitest, 31 tests). No database required:
- env parsing and defaults; rejection messages without values
- every contract error code maps to an HTTP error status
- success/collection/error envelopes and headers
- request-id acceptance and rejection
- zod body/query helpers, including malformed JSON and field paths
- `withApi`: AppError mapping, INTERNAL_ERROR masking, access log without query string
- logger levels, child bindings, recursive redaction, Error/bigint serialization
- readiness up/down/timeout; liveness
- `/api/v1/health` and the `/api/v1/*` NOT_FOUND fallback route

## Edge Cases
- Build without `DATABASE_URL` works: config and the DB client are lazy.
- A malformed or oversized `X-Request-Id` is replaced, not echoed.
- A hanging database ping times out after 2 s and reports `not_ready`.

## Remaining scope for later foundation tasks
- TASK-003: first migration, UUID generator choice, transaction helper, migrate/status scripts, PostgreSQL integration tests.
- TASK-004: seed wiring (`migrations.seed`), owner bootstrap.
- TASK-005: money helpers (minor units, HALF-UP), time handling, and any extra response conventions.
- TASK-006: CI workflow, formatter, test DB provisioning/reset, coverage.

## Open Items
Found while designing the auth architecture. They do **not** block TASK-002 and are recorded here per AGENTS.md; each must be answered before its owning task is implemented.

- **Resolved (Business Spec R13: email + password).** ~~[BUSINESS DECISION REQUIRED] (TASK-007): customer login identifier.~~ Phone is the "primary identifier" (Q41) and email is "used for recovery/communication", but the documents do not say whether customers log in with phone + password, email + password, or either.
- **Resolved (Business Spec R28: email OTP for all staff, 30-day trusted device).** ~~[BUSINESS DECISION REQUIRED] (TASK-011): employee second factor.~~ Q165 says "Email + password + OTP; Owner/Admin also require MFA". Two points are open:
  - is OTP mandatory for every employee, or optional/configurable for non-Owner/Admin roles?
  - is Owner/Admin MFA the same email OTP, or a separate factor (for example an authenticator app)?
- **Resolved (Business Spec R29: 12 h maximum, 60 min idle).** ~~[BUSINESS DECISION REQUIRED] (TASK-011): default staff session lifetime.~~ Q163 requires "safer defaults than customer sessions" but gives no value.
- **Resolved in TASK-007 (Business Spec R23).** ~~[BUSINESS DECISION REQUIRED] (TASK-008): password reset and sessions.~~ User Flows §3.2 says existing sessions are "handled according to security policy", but the policy is not specified (for example, revoke all sessions on reset).
- **Resolved in TASK-007 (Business Spec R25: WhatsApp); changed to email by R30 (2026-10-01).** ~~[BUSINESS DECISION REQUIRED] (TASK-009): phone-change OTP channel.~~ Q153 requires an OTP to the new phone, but SMS is a future channel (R10). The documents don't say whether it is sent via WhatsApp or another channel.
- Technical, not business: `npm audit` reports advisories in Prisma CLI tooling dependencies (ADR-0002). Re-check before production.

## Definition of Done
- All acceptance criteria met and checks passing.
- ADRs and the affected documentation updated.
- One focused commit on `feature/TASK-002-project-foundation`, not pushed.
- Human/product-owner review of the foundation (Roadmap §6 gate 1 applies after TASK-006).

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
