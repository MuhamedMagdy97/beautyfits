# TASK-006 — Test Harness & CI Baseline

## Goal
Make automated verification part of every change: a CI workflow on a clean checkout, a lockfile that installs on Linux, and a formatter. Failed checks must be able to block merging into `main`.

## Dependencies
- TASK-002 (Vitest unit tests, ADR-0009), TASK-003 (PostgreSQL integration tests, ADR-0010), TASK-005 (merged).

## Source of Truth
- `docs/tasks/implementation-roadmap.md` — TASK-006 (goal, scope, acceptance criteria).
- `docs/testing/test-strategy.md` §1, §2 (principles 4 and 5), §4, §8, §9.
- `docs/decisions/ADR-0002` (dependencies), `ADR-0009` (Vitest), `ADR-0010` (integration tests).
- `AGENTS.md` — Development Workflow, Required checks, Git Rules.

## Scope
1. **CI workflow** (GitHub Actions) on every pull request and every push to `main`, on a clean checkout: `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run test:integration` against a PostgreSQL 17 service container (`TEST_DATABASE_URL`), `npm run build`.
2. **Lockfile fix**: `npm ci` fails on Linux with `Missing: @emnapi/runtime@1.11.3 from lock file` and `Missing: @emnapi/core@1.11.3 from lock file` (reproduced in a `node:22-bookworm` container). Regenerate the lockfile so it installs on Linux and Windows; verify both.
3. **Formatter**: Prettier with `format` and `format:check` scripts; `format:check` runs in CI. The existing code is formatted in a separate commit. The decision is recorded in ADR-0012.
4. **Branch protection** instructions (below) so failed checks block merging. The owner enables the setting.

## Non-Goals
- No application behavior, API, database, schema or migration changes.
- No coverage thresholds, E2E tests (TASK-063), deployment pipeline, or release automation.
- No pre-commit hooks (husky/lint-staged): they add dependencies and are not required by the roadmap.
- No change to the unit/integration test design (ADR-0009, ADR-0010).
- No reformatting of the Markdown source-of-truth documents (see Plan, step 3).

## Files / Modules
- `.github/workflows/ci.yml` (new), `.nvmrc` (new: Node 24, shared by local development and CI)
- `package.json`, `package-lock.json`
- `.prettierrc.json`, `.prettierignore` (new)
- Every code/config file touched by the formatting commit (whitespace/format only)
- `docs/decisions/ADR-0012-formatting-and-ci.md` (new), `docs/decisions/README.md`, `docs/decisions/ADR-0009-testing-foundation.md` (deferred items resolved)
- `docs/testing/test-strategy.md`, `AGENTS.md` (Required checks), `README.md`, `docs/tasks/implementation-roadmap.md`

## Business Rules
None. This task introduces no business rules.

## API Changes
None.

## Database Changes
None. CI creates a disposable PostgreSQL 17 service; the test database is rebuilt from the committed migrations (ADR-0010).

## Security / Authorization
- The workflow uses `permissions: contents: read` and no repository secrets. The CI database credentials are throwaway values for a service container that only exists during the job.
- Third-party actions are limited to the official `actions/checkout` and `actions/setup-node`.
- The lockfile is regenerated from the registry with integrity hashes; no dependency versions change except the added Prettier and the missing `@emnapi/*` entries.

## Plan
1. **Lockfile.** In a Linux container (`node:24`, npm 11), run `npm install --package-lock-only --ignore-scripts` against the current `package.json`/lockfile so npm adds the missing `@emnapi/core` / `@emnapi/runtime` entries without upgrading anything else. Review the lockfile diff (only added entries expected). Verify `npm ci` on Linux (container) and on Windows. Prettier is added from the same container so the Windows npm does not rewrite the lockfile.
2. **Prettier** (devDependency, exact version, latest stable 3.x). Config chosen to match the current code so the formatting commit is small: double quotes, semicolons, trailing commas, `printWidth: 100`, `endOfLine: "auto"` (Windows checkouts use CRLF through `core.autocrlf`; the repository stores LF via `.gitattributes`, so CI on Linux sees LF — `auto` keeps both passing). `.prettierignore`: `node_modules`, `.next`, `src/generated`, `package-lock.json`, `prisma/migrations`, `public`, and `*.md` (the Markdown source-of-truth documents are excluded to avoid a large table/list reflow in the business documents; they can be opted in later by a docs task). Check whether ESLint has stylistic rules that conflict with Prettier; add `eslint-config-prettier` only if a conflict is found.
3. **Commits.** (a) tooling: lockfile fix, Prettier config and scripts; (b) `style:` commit that only runs `npm run format`; (c) CI workflow and documentation.
4. **CI workflow** `.github/workflows/ci.yml`, workflow `CI`, one job `verify` on `ubuntu-latest`:
   - triggers: `pull_request` and `push` to `main`; `concurrency` cancels superseded runs of the same branch;
   - `services.postgres`: `postgres:17-alpine` (same image as `docker-compose.yml`) with a `pg_isready` health check;
   - env: `TEST_DATABASE_URL=postgresql://beautyfits:beautyfits@localhost:5432/beautyfits_test?schema=public`, plus a `DATABASE_URL` pointing at the service so `next build` and `getEnv()` validation have a value; no `.env` file exists in CI;
   - steps: checkout → setup-node (Node version from `.nvmrc` via `node-version-file`, npm cache) → `npm ci` → lint → format:check → typecheck → test → test:integration → build;
   - `timeout-minutes: 20`.
5. **Local verification of the workflow.** Run the same step sequence in a clean Linux container (fresh clone of the branch, no `.env`, PostgreSQL 17 container) before pushing, then confirm the first real GitHub Actions run passes on the pull request.
6. **Docs.** ADR-0012 (Prettier + CI); ADR index; ADR-0009 deferred items resolved; test-strategy §1/§9 (required checks, CI, formatter); AGENTS.md Required checks (TASK-006 done: the checks are the CI checks, including `format:check` and `test:integration`); README scripts and CI note; roadmap TASK-006 status.
7. Run all checks, push, open the PR (not merged).

## Making failed checks block merging (owner action)
The only required status check is **`verify`** (workflow `CI`). Do **not** require approvals: the repository has a single developer, and GitHub does not let a pull request author approve their own pull request, so a required approval would block every merge.

**Availability.** Branch protection rules and rulesets on a **private** repository require GitHub Pro (personal account) or Team/Enterprise (organization). They are free on public repositories. If they are not available, the rule is procedural: **no pull request is merged while CI is red.**

GitHub only lists a status check after it has run once, so enable the setting after this pull request's first CI run.

**Option A: Branch protection rule** (Settings → Branches → Add branch protection rule)
1. Branch name pattern: `main`.
2. Enable **Require a pull request before merging**. Leave **Require approvals** unchecked.
3. Enable **Require status checks to pass before merging** and **Require branches to be up to date before merging**. Search for and select **`verify`**.
4. Enable **Do not allow bypassing the above settings**.
5. Leave **Allow force pushes** and **Allow deletions** disabled.
6. Save.

**Option B: Ruleset** (Settings → Rules → Rulesets → New branch ruleset)
1. Name it (for example `main`), set Enforcement status to **Active**, and target the default branch.
2. Enable **Restrict deletions** and **Block force pushes**.
3. Enable **Require a pull request before merging** with **Required approvals: 0**.
4. Enable **Require status checks to pass**, add **`verify`**, and enable **Require branches to be up to date before merging**.
5. Leave the bypass list empty and save.

**Check that it works:** open a throwaway pull request with a deliberately failing check (for example an unformatted file), confirm the merge button is blocked, then close the pull request and delete its branch.

## Acceptance Criteria
- CI runs on every pull request and push to `main` from a clean checkout and executes install, lint, format check, typecheck, unit tests, integration tests (PostgreSQL 17) and build.
- `npm ci` succeeds on Linux and Windows with the committed lockfile.
- `npm run format:check` passes on the formatted code base and fails on unformatted code.
- Failed tests fail the `verify` check; branch protection instructions are documented (roadmap: "Failed tests block merge").
- ADR-0012, test strategy, AGENTS.md required checks and README are updated.

## Tests
- No new application tests (no behavior change). Verification is the full check suite locally, the clean-container dry run, and the GitHub Actions run on the PR.

## Edge Cases
- CRLF working copies on Windows vs LF in CI (Prettier `endOfLine: "auto"`).
- `next build` / Prisma on a clean checkout without `.env`.
- Integration global setup needs the `postgres` maintenance database on the service (default in the image).
- Service container not ready when tests start (health check + Prisma retries).

## Open Decisions
None. No business decision is involved.

## Definition of Done
- Acceptance criteria met, all checks pass locally and in GitHub Actions, docs updated, committed on `feature/TASK-006-ci-baseline`, PR opened (not merged).

## Status
- [x] Planned
- [x] In Progress
- [ ] Tests Passing
- [ ] Reviewed
- [ ] Done
