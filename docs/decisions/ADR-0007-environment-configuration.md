# ADR-0007 — Environment and configuration

- **Status:** Accepted (TASK-002)
- **Date:** 2026-09-30
- **Relates to:** Security Requirements §10; AGENTS.md Security

## Decision

- **Loading.** Next.js loads `.env*` files for `next dev`/`next start`/`next build`. The Prisma CLI loads `.env` via `process.loadEnvFile` in `prisma.config.ts`. Real environments (CI, staging, production) inject variables directly; no `.env` file is deployed.
- **Single access point.** Server code reads configuration only through `getEnv()` in `src/server/config/env.ts`, never through `process.env.X`. The one exception is `LOG_LEVEL` in the logger, which must work even when other config is invalid.
- **Validation.** A zod schema validates the variables on first use (lazily, so `next build` does not need runtime secrets). Invalid config throws `EnvValidationError`, which lists the variable names and problems but **never their values**.
- **Current variables:** `DATABASE_URL` (required, postgres URL), `LOG_LEVEL` (optional), and `NODE_ENV` (set by Next.js/tooling). Only variables that are actually used are added, each at the same time as its schema entry and its line in `.env.example`.
- **`.env.example`** is committed with safe local-development placeholders only. `.gitignore` ignores `.env*` except `.env.example`.
- **No `NEXT_PUBLIC_` secrets.** Variables prefixed `NEXT_PUBLIC_` are inlined into client bundles and must never hold secrets. None exist yet.

## Consequences

- Secrets live in the deployment platform's secret store (TASK-066).
- New integrations (email, WhatsApp, storage) extend the schema in their owning tasks.
