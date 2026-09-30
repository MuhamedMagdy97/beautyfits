# ADR-0012 — Formatting (Prettier) and CI (GitHub Actions)

- **Status:** Accepted (TASK-006)
- **Date:** 2026-09-30
- **Relates to:** ADR-0002, ADR-0009, ADR-0010; Test Strategy §1, §2 (principles 4 and 5), §9; Roadmap TASK-006

## Context

The roadmap requires that CI can run on a clean checkout and that failed tests block merging. ADR-0009 deferred the formatter and the CI workflow to TASK-006. `npm ci` also failed on Linux because the lockfile, written by npm on Windows, lacked the `@emnapi/core` and `@emnapi/runtime` entries (an npm issue with platform-specific optional dependencies).

## Decision

### Formatter: Prettier

- `prettier` **3.9.9** as an exact-pinned devDependency. It is the de-facto formatter for TypeScript/Next.js projects and needs no plugins here.
- `.prettierrc.json` matches the existing style, so adopting it changed only 11 files: double quotes, semicolons, trailing commas, `printWidth: 100`.
- `endOfLine: "auto"`. The repository stores LF (`.gitattributes`: `* text=auto`), Windows working copies use CRLF (`core.autocrlf`), and CI on Linux sees LF. With `auto`, both pass.
- Scripts: `npm run format` (write) and `npm run format:check` (CI).
- `.prettierignore` excludes generated or tool-owned files (`src/generated`, `.next`, `package-lock.json`, `prisma/migrations`, `public`, `next-env.d.ts`) and, for now, all Markdown. Reformatting the source-of-truth documents would realign tables and lists across the business documents; a later documentation task can opt them in.
- ESLint (`eslint-config-next`) has no rules that conflict with Prettier (lint passes on the formatted code), so `eslint-config-prettier` is not added.
- No pre-commit hooks (husky/lint-staged): CI enforces the check without extra dependencies.

### CI: GitHub Actions

- `.github/workflows/ci.yml`, workflow **CI**, one job **`verify`** on `ubuntu-latest`. It runs on every pull request and every push to `main`. Superseded pull-request runs are cancelled.
- Steps on a clean checkout: `npm ci` → `lint` → `format:check` → `typecheck` → `test` → `test:integration` → `build`. Any failing step fails `verify`.
- Node.js comes from `.nvmrc` (`24`) through `setup-node`'s `node-version-file`, so local development and CI use the same major version. `package.json` still declares the minimum (`>=20.19`).
- PostgreSQL 17 (`postgres:17-alpine`, the image used in `docker-compose.yml`) runs as a service container. `TEST_DATABASE_URL` points to `beautyfits_test`, which the integration global setup recreates from migrations (ADR-0010). `DATABASE_URL` is also set because CI has no `.env` file.
- Security: `permissions: contents: read`, no repository secrets, only the official `actions/checkout` and `actions/setup-node` (major-version tags). The database credentials are throwaway values for a container that exists only during the job.
- One job instead of parallel jobs keeps a single required status check (`verify`) for branch protection. Split it if run time becomes a problem.

### Lockfile

- The lockfile was regenerated with npm 11 on Linux (`npm install --package-lock-only`). This added the missing `@emnapi/*` entries without changing any resolved version. `npm ci` was verified on Linux (Node 22 and 24) and on Windows.
- To avoid reintroducing the problem, dependency changes should be checked with `npm ci` in CI, which now happens on every pull request.

### Merge gate

Failed checks block merging through GitHub branch protection or a ruleset on `main` that requires the `verify` check. The repository owner enables it; the steps are in `docs/tasks/TASK-006-ci-baseline.md`. Branch protection on a private repository requires GitHub Pro, Team or Enterprise, or a public repository. Without it, the rule is procedural: no pull request is merged while CI is red.

## Consequences

- Every pull request is verified on a clean Linux checkout with a real PostgreSQL, matching what contributors run locally.
- Contributors run `npm run format` before committing; `format:check` fails CI otherwise.
- Coverage thresholds, E2E tests (TASK-063) and deployment pipelines remain out of scope.
