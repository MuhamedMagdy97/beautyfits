# ADR-0002 — Dependency baseline

- **Status:** Accepted (TASK-002)
- **Date:** 2026-09-30

## Context

The starter `package.json` contained dependencies installed ahead of any decision. None of them were used by any source file. Some were inconsistent: the `prisma` CLI was `8.0.0-rc.15` (a pre-release) while `@prisma/client` was `7.10.0`, and Prisma requires the CLI and client versions to match. AGENTS.md forbids keeping dependencies without a concrete reason.

## Decision

| Package | Change | Reason |
|---|---|---|
| `next-auth` 4.24 | **Removed** | Does not fit the required auth model; see ADR-0008. |
| `zustand` | **Removed** | Unused. Client state management is a UI concern for later frontend tasks; re-add with a reason if needed. |
| `react-hook-form` | **Removed** | Unused. Re-evaluate when the first form is built (TASK-059 / TASK-052). |
| `lucide-react` | **Removed** | Unused. Re-evaluate with the UI/design-system work. |
| `prisma` 8.0.0-rc.15 | **Replaced** by `prisma` **7.10.0** (devDependency) | Must match `@prisma/client` exactly; 7.10.0 is the latest stable release. The CLI is build/dev tooling. |
| `@prisma/client` | **Pinned** to `7.10.0` (exact) | Prevents CLI/client drift. |
| `@prisma/adapter-pg` 7.10.0 | **Added** (exact) | Prisma 7 requires a driver adapter; this is the official PostgreSQL adapter (brings `pg`). |
| `vitest` 4 | **Added** (dev) | Test runner (ADR-0009). |
| `zod` 4 | Kept | Server-side validation (ADR-0005). |
| `next`, `react`, `react-dom`, `typescript`, `eslint`, `eslint-config-next`, `tailwindcss`, `@tailwindcss/postcss`, `babel-plugin-react-compiler`, `@types/*` | Kept | Framework, tooling, and existing config (`reactCompiler: true`, Tailwind in `globals.css`). |

Also:

- `"engines": { "node": ">=20.19" }` is the minimum required by Prisma 7 (Next.js 16 needs ≥ 20.9).
- A `postinstall: prisma generate` script makes sure the generated client exists after `npm install` on a clean checkout. The generated client is gitignored.
- No logging, env-loading (`dotenv`), or auth library is added. Platform features cover these (ADR-0006, ADR-0007, ADR-0008).

## Known issue

`npm audit` reports high-severity advisories in Prisma CLI tooling dependencies (`mysql2` and `deepmerge-ts` via `prisma`/`@prisma/config`). They affect developer tooling, not the application's PostgreSQL runtime path. The old `8.0.0-rc` had them too. npm's only offered fix is a downgrade to Prisma 6, which is not acceptable. Track upstream, and re-check before production deployment (TASK-061/TASK-066).

## Consequences

Every future dependency needs a stated reason, recorded in the task file or an ADR.
